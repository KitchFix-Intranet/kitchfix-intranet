# KPI Technical Handoff

**Purpose.** Repo + pipeline state as built, for the KPI workstream (labor + purchasing). Complement to Chat-Claude's design/architecture handoff; where the two overlap defer to this doc for "what the code does" and to Chat-Claude's for "why".

**Read time.** ~1 hour to be productive. Terse by design. `file:line` beats prose. Uncertain claims flagged `verify`.

**Head SHA when written.** `main` at `0b5250f` (post PR #713 + PRs #714, #716, #717, #718 landed).

---

## 1. Repo map (KPI surface)

`*` = load-bearing. `-` = supporting/probe/one-shot.

### API routes

| file | notes |
|---|---|
| `src/app/api/kpi/labor/route.js` * | GET labor board data. Reads `labor_actuals_latest`, `labor_unattributed`, `rippling_raw_workers_latest`, `rippling_raw_users_latest`, `rippling_walks`, `earning_type_unmapped`, `sc_day_metadata`, `kpi_budgets`, `sc_labor_budgets`, `kpi_roles`, `accounts`, `labor_salary_actuals`. Auth-gated. |
| `src/app/api/kpi/labor/export/route.js` * | CSV export of labor rows. |
| `src/app/api/kpi/labor/views/route.js` | Saved-view CRUD (list+create). |
| `src/app/api/kpi/labor/views/[id]/route.js` | Saved-view CRUD (get/update/delete). |
| `src/app/api/kpi/purchasing/route.js` * | GET purchasing board data. Reads `purchasing_actuals`, `kpi_budgets`, `rippling_raw_spend_lines_latest`, `spend_work_location_site_map`, `rippling_department_map`, `billcom_raw_bills_latest`, `purchasing_derive_runs`, `accounts`. Auth-gated (with `TEST_MODE` bypass mirroring middleware). |

### Client pages / components (labor board)

| file | notes |
|---|---|
| `src/app/kpi/labor/page.js` * | Route entry; owns fetch + toggle state. |
| `src/app/kpi/labor/components/Shell.js` * | Frame + `salaryToggle` slot. |
| `src/app/kpi/labor/components/SignalCards.js` * | Four-up card row. |
| `src/app/kpi/labor/components/StoryBlock.js` * | Sub-line narrative (basis / vacancy / +Salary label). |
| `src/app/kpi/labor/components/ComparisonStrip.js` * | Prior-period compare rail. |
| `src/app/kpi/labor/components/DetailsStrip.js` * | Second details strip. |
| `src/app/kpi/labor/components/StateBoxes.js` | State-of-account cards. |
| `src/app/kpi/labor/components/WeekTable.js` | Weekly grid. |
| `src/app/kpi/labor/components/FolioRail.js` | Account folio nav. |
| `src/app/kpi/labor/components/CalendarPopover.js` | Range picker. |
| `src/app/kpi/labor/components/RangeMenu.js` | Range preset menu. |
| `src/app/kpi/labor/components/Toast.js` | Toast primitive. |
| `src/app/kpi/labor/lib/board.js` * | `buildBoard`, `buildWeekBudgets`, `buildAggregateWeekBudgets`, `computePeriodMeasures`. |
| `src/app/kpi/labor/lib/periods.js` * | `FY_START_ISO`, `FY_END_ISO`, `periodOf`, `periodStartISO`, `periodEndISO`, `weekStartsInRange`, `inferRangeSelection`, `currentPeriodNo`. |
| `src/app/kpi/labor/lib/budgets.js` | Budget helpers. |
| `src/app/kpi/labor/lib/accounts.js` | Account helpers. |
| `src/app/kpi/labor/lib/formatting.js` | Number/date formatters. |
| `src/app/kpi/kpi.css` * | Board CSS. |

Purchasing has no UI yet (Phase 1 is data-only; the board is Phase 2, deferred).

### Lib

| file | notes |
|---|---|
| `src/lib/rippling.js` * | REST client (`fetchPage`, `firstPageUrl`, `contentHash(payload, kind)`, `extractRows`). Per-kind hash exclude lists live here. |
| `src/lib/billcom.js` * | proxy client (`fetchJson`, `extractRowsV2`, `billsFilteredUrl`, `chartOfAccountsUrl`, `classesUrl`, `contentHash(payload, kind)`, `isPaid`, `glBucketFor`). |
| `src/lib/labor/deriveActuals.js` * | Labor derive core (`deriveLaborActuals`, `writeLaborDerivation`). Uses per-account RPC swap. |
| `src/lib/labor/salaryGate.js` * | `loadSalaryGate(supa)` returns `canSeeSalary`, `salaryAvailable` closures. Sole authority; role x scope. |
| `src/lib/labor/salaryBoard.js` * | `load3100_2Budgets`, `loadSalaryActuals`, `mergeBudgetPeriods`, `withSalary` (route-side merge). |
| `src/lib/kpi/floors.js` * | `DOLLAR_COVERAGE_FLOOR` (C6.1 partition marker). |
| `src/lib/kpi/resolveName.js` * | Worker-name resolver via `/users` payload. |
| `src/lib/kpi/dateResolve.js` | Date helpers. |
| `src/lib/dataStore/kpi.js` | Data-store shell (largely unused - route is direct-Supabase). |
| `src/lib/dataStore/laborBudgets.js` | Budget data-store shell (largely unused). |

### Sync + derive scripts

| file | notes |
|---|---|
| `scripts/rippling_sync.mjs` * | Six-walk raw ingest: `time_entries`, `pay_segments`, `workers`, `time_entry_zo`, `users`, `compensations`. Table lock, per-page hash-and-insert, `commit_walk_success` RPC swaps presence. |
| `scripts/derive_labor_actuals.mjs` * | CLI over `deriveLaborActuals`. Runs after sync in workflow. Exits 3 if derive > 10 min (D38). |
| `scripts/derive_salary_actuals.mjs` * | Rebuild `labor_salary_actuals` for `trailing8` (default) or `fytd` window. Not yet wired into a workflow (PR #715 open). |
| `scripts/purchasing_billcom_sync.mjs` * | ref refresh (accounts+classes), bills window walk, per-bill DELETE+INSERT derive, 7 probes (P1-P7). |
| `scripts/purchasing_rippling_sync.mjs` * | spend-line walk, category candidate populate, per-line derive with label-fallback self-heal, 7 probes (R1-R7). |
| `scripts/purchasing_billcom_rederive.mjs` - | one-shot rebuild across all bills; shares `purchasing_billcom_sync` lock. |
| `scripts/backfill_labor_from_rippling_report.mjs` - | pre-floor backfill loader (owner of weeks `week_start < DOLLAR_COVERAGE_FLOOR`). |
| `scripts/verify_labor_actuals_by_source.mjs` - | ad-hoc verifier. |
| `scripts/_seed_sc_labor_budgets.mjs` - | seed helper. |

### Probes (KPI-relevant subset)

| file | scope |
|---|---|
| `scripts/_probe_derive_pay_segments_s1i.mjs` * | S1i - raw-vs-external_id dedup identity per (account, period). Red-by-design against raw until Rippling stops re-issuing `rippling_id`. |
| `scripts/_probe_salary_s1.mjs` * | S1..S1h - salary derive. |
| `scripts/_probe_salary_s2.mjs` * | S2..S7 + salary sentinel (`CIN - OH` P8). |
| `scripts/_probe_kpi_salary_toggle.mjs` * | PR 3 - +Salary toggle wiring, code-read + optional Playwright. |
| `scripts/_probe_labor_budget_acceptance.mjs` | budget resolution acceptance. |
| `scripts/_probe_labor_plans.mjs` | supersede/PnL plan checks. |
| `scripts/probes/_probe_work_location_ids.mjs` | seed helper - list distinct (id,label) pairs. |
| `scripts/probes/_probe_before_state.mjs` | pre-migration snapshot. |
| `scripts/probes/_probe_after_state_projection.mjs` | post-migration projection. |
| `scripts/probes/_probe_normalize_verify.mjs` | verify spend-line normalizer output non-null counts. |
| `scripts/probes/_probe_post_fix_report.mjs` | post-fix snapshot. |
| `scripts/probes/_probe_rippling_spend_payload.mjs` | payload shape spike. |
| `scripts/probes/_probe_rippling_spend_extra_fields.mjs` | payload shape spike. |
| `scripts/probes/_probe_rippling_spend_attribution_axes.mjs` | department vs work_location distribution. |

Inline probes: `runProbes` inside `purchasing_billcom_sync.mjs` (P1-P7) and `purchasing_rippling_sync.mjs` (R1-R7). Non-zero exit if any fail.

### Workflows

| file | trigger |
|---|---|
| `.github/workflows/rippling-sync.yml` * | cron `0 7 * * *`; runs `rippling_sync.mjs` then, on success, `derive_labor_actuals.mjs`. Timeout 120 min. |
| `.github/workflows/purchasing-sync.yml` * | cron `30 7 * * *`; runs `purchasing_billcom_sync.mjs`, then unconditionally (`if: always()`) `purchasing_rippling_sync.mjs`. Timeout 90 min. |
| `.github/workflows/migration-gate.yml` * | required check on PRs adding `docs/migrations/*.sql`; Job A scans on `pull_request`, Job B flips green on OWNER comment matching `applied in Studio: YES`. |
| `.github/workflows/e2e.yml` | Playwright. |
| `.github/workflows/opd-autoprojection.yml` | OPD (unrelated). |
| `.github/workflows/price-change-nightly.yml` | pricing (unrelated). |

No KPI cron in `vercel.json` - all KPI syncs run via GitHub Actions (Vercel 300s function cap does not fit the walks).

### Migrations (KPI-relevant)

Applied in Studio one statement at a time. Migration gate blocks merges without the OWNER attestation.

| file | scope |
|---|---|
| `docs/migrations/kpi-1-spine.sql` | portfolio spine + accounts. |
| `docs/migrations/kpi-1b-activation-fk.sql` | activation FK. |
| `docs/migrations/kpi-2-budget-values.sql` | `kpi_budgets` seed. |
| `docs/migrations/kpi-2b-grants.sql` | grants. |
| `docs/migrations/kpi-8a-rippling-raw.sql` * | raw tables + `_latest` views for time_entries + pay_segments; `rippling_sync_locks`. |
| `docs/migrations/kpi-8a2-raw-extension.sql` * | workers + time_entry_zo tables/views + presence + walks + `commit_walk_success` RPC. |
| `docs/migrations/kpi-8ba-presence-and-earning-type-map.sql` * | `rippling_current_presence`, `earning_type_map`, `rippling_department_map`. |
| `docs/migrations/kpi-8bb-labor-actuals-and-derivation.sql` * | `labor_actuals` + `labor_actuals_latest` + `labor_unattributed` + `swap_labor_actuals_for_account` + `swap_labor_unattributed_all` RPCs. |
| `docs/migrations/kpi-8bc-labor-actuals-week-start-key-and-safe-delete.sql` * | PK on (`account_key`, `worker_id`, `week_start`, `line_code`) - fixes the grain-collapse-by-week_label bug. |
| `docs/migrations/kpi-c4-saved-views.sql` | saved views. |
| `docs/migrations/kpi-c5-users-raw.sql` * | `rippling_raw_users` + `_latest`. |
| `docs/migrations/kpi-c6-labor-actuals-source-and-scoped-swap.sql` * | source column + scoped-swap semantics; enables `report_backfill` co-tenancy per C6.1. |
| `docs/migrations/purchasing-1-schema.sql` * | 752 lines - `billcom_raw_bills`, `billcom_raw_bill_lines`, `billcom_ref_accounts`, `billcom_ref_classes`, `billcom_class_site_map`, `rippling_raw_spend_lines`, `spend_category_map`, `spend_department_site_map` (deprecated), `purchasing_actuals`, `purchasing_derive_runs`, `purchasing_sync_locks`, `_latest` views. |
| `docs/migrations/purchasing-2-work-location-attribution.sql` * | 262 lines - `spend_work_location_site_map` (id-keyed, owner-seeded); moves attribution axis department -> work_location per owner ruling 2026-08-18. |
| `docs/migrations/salary-1a-rippling-raw-compensations.sql` * | `rippling_raw_compensations` + `_latest` with projected columns (`worker_id`, `payment_type`, `annual_value`, `salary_effective_date`, `currency`). |
| `docs/migrations/salary-1b-labor-salary-actuals.sql` * | `labor_salary_actuals` PK (`account_key`, `worker_id`, `week_start`). |
| `docs/migrations/salary-1c-kpi-roles.sql` * | `kpi_roles` (role x scope: corporate | rdo | site). |
| `docs/migrations/rippling-presence-external-id-view.sql` * | view exposing `external_id` alongside presence (PR #717 - future audits). |
| `docs/migrations/sc-20-labor-budgets.sql` | `sc_labor_budgets` (supersede layer). |
| `docs/migrations/sc-21-labor-budgets-period-convention.sql` | period-string convention. |

---

## 2. Pipelines end-to-end

### 2A. Rippling labor (`time_entries` + `pay_segments` + `workers` + `time_entry_zo` + `users`)

| aspect | value |
|---|---|
| client | `src/lib/rippling.js` |
| auth | `Authorization: Bearer $RIPPLING_API_KEY`, `X-Rippling-Api-Version: 2024-08-01` |
| base | `https://rest.ripplingapis.com` |
| endpoints | `/time-entries`, `/custom-objects/time_entry_computed_pay_segment/records`, `/workers`, `/custom-objects/time_entry_zo/records`, `/users` |
| pagination | cursor at `body.next_link`. Absent -> done. **Date, worker_id, and sort filters are silently ignored** - full walk every time. Limit=100. |
| latency baseline | time_entries ~8.08s/pg ~200pg; pay_segments ~1.5s/pg ~80pg; workers ~1.5s/pg ~12pg; time_entry_zo ~1s/pg ~82pg; combined ~30 min. |
| raw tables | `rippling_raw_time_entries`, `rippling_raw_pay_segments`, `rippling_raw_workers`, `rippling_raw_time_entry_zo`, `rippling_raw_users` |
| dedup | append-only-on-hash-change. `contentHash(payload, kind)` with per-kind top-level excludes + universal nested-strip of `display_value` / `has_perm` / `image`. |
| `_latest` view | `DISTINCT ON (rippling_id)` ORDER BY `fetched_at DESC`. |
| presence | `rippling_current_presence(kind, rippling_id)`. `rippling_walks` row + `commit_walk_success(walk_id, kind, ids[], pages, dur, min_examined)` RPC atomically swaps presence and marks walk success (or `failed_plausibility` if new count < 50% of prev walk). |
| lock | `rippling_sync_locks` (name PK, 4h TTL). Reap-then-insert. |
| derive | `src/lib/labor/deriveActuals.js` -> `scripts/derive_labor_actuals.mjs` |
| derive input | `rippling_raw_pay_segments` (all versions), `rippling_current_presence`, `rippling_raw_workers_latest`, `rippling_raw_time_entries_latest`, `rippling_raw_time_entry_zo_latest`, `earning_type_map`, `rippling_department_map`, `sc_day_metadata`. |
| derive filters (order) | 1) presence-filter raw pay-segments (`rippling_id` in presence). 2) external_id dedup: keep row with latest `system_updated_at` per `external_id` (2026-08-19 hotfix; segments without `external_id` pass through). 3) attribute worker via `rippling_department_map` (CORP dropped; D26 salaried-only 3100.1 dropped). 4) earning-type via `earning_type_map` merged name -> bucket (regular/overtime/double_time/premium_other). 5) week resolver via `sc_day_metadata`, ISO fallback. |
| derive bucket key | `(account_key, worker_id, week_start, line_code)` - **not week_label** (label collides across periods, caused a 4x row merge on 2026-08-08 - fixed in kpi-8bc). |
| stale-presence gate | if last successful `pay_segments` walk > 54h ago (or missing) -> every row `coverage_state='unknown'`; dashboard blanks. |
| sanity asserts | pre-write: `hours_regular > 48`, total hours > 168, or `|amount - sum(dollar buckets)| > 0.05` -> throw. Wrote 152.65-hour row once; asserts stop reshipping. |
| pre-floor partition | `week_start < DOLLAR_COVERAGE_FLOOR` (`src/lib/kpi/floors.js`) -> emit nothing. Owned by `backfill_labor_from_rippling_report.mjs`. |
| output | `labor_actuals` written via `swap_labor_actuals_for_account(p_account_key, p_actuals JSONB, p_source_run)` (per-account atomic swap), `labor_unattributed` via `swap_labor_unattributed_all`, `earning_type_unmapped` via UPSERT (SET semantics, preserves `first_seen_at`). |
| workflow | `.github/workflows/rippling-sync.yml`, `0 7 * * *`. Dispatch inputs: `source` (nightly|backfill|manual), `dry_run` (true|false). Derive step gated `if: success() && dry_run != 'true'`. |
| probes guarding | sanity asserts in `deriveActuals.js:559-577`. S1i probe (`scripts/_probe_derive_pay_segments_s1i.mjs`) asserts raw-vs-dedup identity per (account, period). Sanity assert fail -> nightly RED, no writes. |

### 2B. Rippling compensations (salary)

Sixth walk in the same `rippling_sync.mjs` run. Reads `/compensations`; `worker.compensation_id` on `/workers` is a REFERENCE, the record lives here with `salary_effective_date`, `payment_type`, `annual_compensation.value`.

| aspect | value |
|---|---|
| endpoint | `/compensations` |
| walk | shares the `rippling_sync` script and lock. Same cursor-walk contract; date filter silently ignored (S0b: `?worker_id=` returned 5 rows on single-worker query). |
| raw table | `rippling_raw_compensations` (JSONB `payload` + projected columns `worker_id`, `payment_type`, `annual_value`, `salary_effective_date`, `currency`). |
| projection | `project` hook in `scripts/rippling_sync.mjs:428-438` - JSONB stays authoritative. |
| `_latest` view | `DISTINCT ON (rippling_id) ORDER BY fetched_at DESC` (`salary-1a-...sql:143`). |
| derive | `scripts/derive_salary_actuals.mjs`. Salaried predicate: `worker.overtime_exemption === 'EXEMPT'` (payment_type ruled out at C2). |
| derive input | `rippling_raw_workers_latest`, `rippling_raw_compensations_latest`, `rippling_department_map`. |
| derive filters (order) | 1) worker `EXEMPT` only. 2) skip null `annual_value` (VARIED records). 3) drop CORP-mapped departments. 4) per-week: `worker.start_date <= week_end` AND (`end_date` null or >= `week_start`) AND status not TERMINATED before week_start. 5) pick compensation with latest `salary_effective_date <= week_start`; fallback earliest if none. |
| formula | `amount = annual_value / 52` per active week. Bonuses / commission / relocation / signing NOT included. |
| window | `--window=trailing8` (default, last 8 fiscal weeks, DELETE+INSERT) or `--window=fytd` (backfill; every week from FY2026 open). |
| output | `labor_salary_actuals` (PK `account_key`, `worker_id`, `week_start`). |
| workflow | **not yet in a nightly** - PR #715 open ("chore: rippling-sync workflow adds nightly salary derive step"). Run manually locally via CLI. verify. |
| probes | `scripts/_probe_salary_s1.mjs` (S1..S1h), `scripts/_probe_salary_s2.mjs` (S2..S7 + sentinel). Salary sentinel: CIN - OH P8 rows + amount as percent of budget - value frozen in PR body, verify against `_probe_salary_s2.mjs:224-232`. |

### 2C. Rippling spend (card)

Separate script, separate lock, separate schedule.

| aspect | value |
|---|---|
| script | `scripts/purchasing_rippling_sync.mjs` |
| client | `src/lib/rippling.js` (shared) |
| endpoint | `/custom-objects/spend_transaction_line_item_zo/records` |
| parent object | `/custom-objects/spend_transaction_zo/records` - **BLOCKED**. Rippling returns 400 `Field with name purchase_location not found`. Do NOT retry. Merchant + parent id come from `spend_transaction` FK on the line-item payload (`display_value` = merchant name). |
| raw table | `rippling_raw_spend_lines` (JSONB `raw` + projected columns: `amount`, `currency`, `category_id`, `department_id`, `department_label`, `work_location_id`, `work_location_label`, `merchant_name`, `parent_txn_id`, `embedded_document_id`, `updated_at`, `external_id`). |
| payload notes | `amount` is `{ currency_type, value: STRING }` OBJECT. `category` is a BARE STRING id (no `display_value`). Both cases fixed in `normalizeSpendLine` (`purchasing_rippling_sync.mjs:254-320`) with projection-repair inserts when the fixed normalizer produces non-null where an older latest row has null. |
| dedup | `spendContentHash(payload)` - local, `SPEND_HASH_EXCLUDE_TOP = {updated_at, mongo_updated_at, system_updated_at, __meta}` + nested-strip. Compare-then-insert vs `rippling_raw_spend_lines_latest`. |
| lock | `purchasing_sync_locks` (name `purchasing_rippling_sync`, 4h). |
| candidate maps | `spend_category_map` (owner-labelled). Distinct `category_id` from walk -> UPSERT `ON CONFLICT DO NOTHING` (labelled rows never overwritten). Department candidate populate was deleted per owner ruling 2026-08-18. |
| attribution axis | **`work_location`**, never `department`. `spend_work_location_site_map` is owner-seeded in `purchasing-2-work-location-attribution.sql`, id-keyed, `excluded` boolean; excluded rows must carry `account_key=NULL` (constraint). |
| label fallback | when `work_location_id` misses the map, compare label vs exact 3-literal set `{"Remote", "Corporate (CORP)", "Headquarters & Chicago Commissary Kitchen"}` (case-sensitive full-string). Match -> `excluded=TRUE`, `account_key=NULL`, self-heal INSERT into `spend_work_location_site_map` (`purchasing_rippling_sync.mjs:79-83, 500-546, 603-628`). |
| derive | per-line DELETE-then-INSERT into `purchasing_actuals`. `account_key = spend_work_location_site_map[work_location_id].account_key`. `excluded = wlRow.excluded || labelFallbackHit`. `gl_line_code = spend_category_map[category_id].gl_line_code` (null if unlabelled). `gl_bucket` via prefix rule on `gl_line_code`: `32|34|35 -> pl_cogs`, `13 -> reimbursable`, `5 -> sga`, else `other`. `txn_date = first_seen_at` (`approx_date=TRUE` because parent txn is blocked). |
| output | `purchasing_actuals` rows: `source='rippling_spend'`, `source_line_id='rippling_spend:<uuid>'`. |
| chunking | latest-lookup + delete + probe IN() chunked at 100 (`source_line_id` is 51 chars; 500-per-chunk overflows URL). |
| workflow | `.github/workflows/purchasing-sync.yml`, `30 7 * * *`. Rippling step runs `if: always()` after billcom - a bill.com proxy 500 must not skip the card refresh. |
| probes | R1 no (source, source_line_id) dupes. R2 excluded rows carry `account_key=NULL` (paginated). R3 CIN-AZ 5006.1/5016.6 present OR categories still awaiting labels (informational). R4 content-hash idempotency on sample. R5 no map row has excluded=TRUE AND account_key!=NULL. R6 same shape in `purchasing_actuals`. R7 no raw row with fallback-label label whose derived state is not excluded (paginated). Exit 4 on any FAIL. |

### 2D. bill.com

| aspect | value |
|---|---|
| script | `scripts/purchasing_billcom_sync.mjs` |
| client | `src/lib/billcom.js` |
| proxy base | `$BILLCOM_PROXY_BASE` (Josh's ngrok tunnel, colocated with QBO proxy). |
| auth | static `X-API-Key: $BILLCOM_PROXY_KEY`. Proxy holds bill.com OAuth server-side. |
| endpoints | `/billcom/bills/filtered?invoiceDateStart&invoiceDateEnd&start&max` (v2 envelope, `response_data` is the row array), `/billcom/chartofaccounts?start&max` (~1,072 rows across 2 pages of 999), `/billcom/classes?start&max` (~51 rows one page), optional `/billcom/bills/{id}/lineItems` (unused - line items embed in /filtered response). |
| response envelopes | **/bills** returns v3 (`results`); the new proxy endpoints (`/chartofaccounts`, `/classes`) return v2 envelope (`response_data`). `extractRowsV2` handles both by falling through `response_data` -> `results` -> `data` -> array. verify by proxy version. |
| pagination | `start` offset, `max=500`. End detected by `rows.length < max`. |
| ref refresh | full DELETE-then-INSERT per run (`billcom_ref_accounts`, `billcom_ref_classes`). `TRUNCATE` intentionally not granted to service_role (money-adjacent standing rule). |
| raw tables | `billcom_raw_bills` + `billcom_raw_bills_latest` (DISTINCT ON `bill_id`); `billcom_raw_bill_lines` + `_latest` (DISTINCT ON `line_id`). Append-only-on-hash-change. |
| hash exclude | `bill` / `bill_line` / `account` / `class`: `{updatedTime, cacheAt, __meta}` + universal nested-strip. `updatedTime` ticks on identical content. |
| window | trailing 45 days on `invoiceDate` for `--source=nightly`. `--source=fytd --period=N` walks period N. Hard cap 40 pages (~20k bills/window). |
| paid semantic | `paymentStatus="0"` (per tenant) OR `paidAmount ≈ amount` within 1c. `PAYMENT_STATUS_PAID = new Set(["0"])`. Codes return as STRINGS ("0", "1", "3", "4"), never compare as number without cast. |
| gl mapping | `chartOfAccountId -> billcom_ref_accounts.account_number` **IS the GL code** (per Josh's 2026-08-18 unlock). |
| site mapping | `billcom_class_site_map`: `actg_class_id -> account_key`, `excluded=TRUE` for CORPORATE + CHICAGO. Class ids inline in `docs/KPI_PURCHASING_MASTER.md` §2.1. |
| derive | per-bill atomic: compute new row set in memory -> `DELETE FROM purchasing_actuals WHERE source='billcom' AND source_bill_id=<id>` -> `INSERT` new rows. Failure leaves last-good OR next run's idempotent DELETE+INSERT restores. |
| output | `purchasing_actuals` rows: `source='billcom'`, `source_line_id='billcom:<line_id>'`, `approx_date=false`. |
| workflow | `.github/workflows/purchasing-sync.yml`, `30 7 * * *`. `--period=N` accepted only when `--source=fytd`. |
| probes | P1 sum(lines).amount == header.amount within 1c (per touched bill). P2 `purchasing_actuals` row count == raw line count for touched. P3 no `(source, source_line_id)` duplicates. P4 excluded rows have `account_key=NULL`. P5 content-hash idempotent on sample. P6 unattributed + uncoded counts (informational). P7 uncoded rows whose `chart_of_account_id` EXISTS in `billcom_ref_accounts` (lookup-miss bug indicator; must be 0). Exit 4 on FAIL. |

---

## 3. Gotchas ledger

Each caught by a probe or a code pattern; failure class -> fix pattern.

| symptom | cause | fix pattern | caught by |
|---|---|---|---|
| `.select()` returns 1000 rows silently, downstream sees partial data | PostgREST default response cap = 1000 | Paginate every scan via `.range(from, from+PAGE-1)` loop, break when `rows.length < PAGE`. Hit three separate places: (a) `billcom_ref_accounts` map load - 72 rows truncated silently, sub-accounts like `1371.2` lost (fix at `purchasing_billcom_sync.mjs:484-501`); (b) S1h pay-segment scan; (c) probe denominators (R2, R7 in `purchasing_rippling_sync.mjs` fixed in commit `277f976`). | `fetchAll` helper pattern; probes now print `bad=X/total`. |
| `TypeError: fetch failed` before any HTTP status | `.in(col, ids)` URL overflow past ~500 UUIDs (36 chars each) | Chunk `.in()` at 100 when values are 36+ char UUIDs (rippling_id) or 51+ char (`rippling_spend:<uuid>`). See `purchasing_rippling_sync.mjs:484` (`CHUNK_IDS=100`), `:581-582`, `:834-835`. billcom bill_id is short - chunk at 500 there. | The chunking pattern in every `.in()` call. |
| `.range()` returns different rows on retry | PostgREST default order is undefined | Always chain `.order(...)` before `.range(...)`. e.g. `paginateActuals` in labor route uses 3-key order. | code convention. |
| Same logical segment counted 2x-3x in labor | Rippling re-issues `rippling_id` for same `external_id` (2026-08-19). `system_updated_at` differs; `owner_role` denorm block differs; `external_id` stable. | Dedup on `external_id` after presence-filter, first-seen-wins by latest `system_updated_at`. `deriveActuals.js:237-249`. Sanity assert `hours_regular > 48` caught the initial 3.3x inflation before it shipped. | S1i probe (`_probe_derive_pay_segments_s1i.mjs`) - stays red vs raw on purpose. |
| Rippling filter surface silently ignored | `?worker_id=`, `?date=`, `?sort=` on `/time-entries`, `/custom-objects/*/records`, `/compensations` return unfiltered results | Full cursor walk every run. Content-hash makes re-fetches cheap. | rippling.js header comments; per-endpoint discovery notes. |
| `worker.compensation` on `/workers` is null with a reference | it IS a reference; real record lives at `/compensations` | Sixth walk in `rippling_sync.mjs`; projection columns land the fields the derive needs without JSONB unpacking. | S0b spike; salary derive skips null `annual_value` and reports `skipped_no_worker/not_exempt/no_annual`. |
| Amount silently null on every rippling spend row | `amount` is `{value: "STRING", currency_type}` OBJECT, not scalar | `normalizeSpendLine` reads `row.amount.value` first, scalar fallback preserved. Throws on unparseable value (never silent null). Projection-repair path in walk inserts corrective row when old latest has null and new normalizer produces non-null. `purchasing_rippling_sync.mjs:272-293, 374-410`. | `_probe_normalize_verify.mjs`; R4 (content-hash idempotency) surfaces re-run drift. |
| Category id silently null on every rippling spend row | `category` is BARE STRING id in payload, not nested object | accept both shapes in `normalizeSpendLine`. `purchasing_rippling_sync.mjs:261-270`. | same as above. |
| Grain-collapse (four "Week 4"s merged, 152.65 hours row) | bucket keyed on `week_label` (period-relative, non-unique across periods) | Key on `week_start` (real date). Schema PK matches (`kpi-8bc-...sql`). | `deriveActuals.js:371` + sanity asserts. |
| Migration-gated PR merged before Studio apply (2026-07-11 sc-16, 2026-07-12 sc-17) | drafts flipped to ready-for-review before manual apply | `.github/workflows/migration-gate.yml`. Job A fails on any added `docs/migrations/*.sql`; Job B flips green only on OWNER comment containing `applied in Studio: YES`. Per-SHA reset - any push re-runs Job A. | Migration gate required check. |
| bill.com paidAmount + paymentStatus disagree | v2 numeric-code semantics inverted for this tenant (`"0"` = paid, not `"1"`/`"4"`) | `isPaid` returns TRUE if code in `{"0"}` OR paidAmount ≈ amount within 1c. Defense in depth. | `billcom.js:200-208`; distribution asserted in prod first-run comments. |
| `chartOfAccountId` -> gl_line_code sub-accounts (1371.2, 3200.1.2) silently missing | `billcom_ref_accounts` has 1,072 rows; single `.select()` capped at 1000; tail 72 include multi-dot codes | Paginate ref load via `.range(start, start+PAGE-1)` up to 20 iters. Cause + fix at `purchasing_billcom_sync.mjs:475-502`, `:791-808`. | P7 probe (uncoded rows whose coa EXISTS in ref -> FAIL). |

---

## 4. Probe inventory

Every probe surfaced by the KPI workstream, current disposition. `RED-BY-DESIGN` means the probe measures raw input; the derive corrects downstream and its writes are green. Do not "fix" the red by editing the probe.

| id / script | asserts | added in | current status |
|---|---|---|---|
| P1..P7 (inline in `purchasing_billcom_sync.mjs`) | sum(lines) == header (P1), pa row count == raw line count (P2), no dupes (P3), excluded null-key (P4), hash idempotent (P5), unattributed/uncoded info (P6), no lookup-miss (P7) | PR #707 (C2) | green as of `main`; P7 revealed sub-account cap bug fixed by pagination (commit `673961c`). |
| R1..R7 (inline in `purchasing_rippling_sync.mjs`) | no dupes (R1), excluded null-key (R2 paginated), CIN-AZ or awaiting-labels (R3), hash idempotent (R4), map excluded rows null-key (R5), same in actuals (R6), no fallback-label with non-excluded state (R7 paginated) | PR #707 (C3) then hardened in `1939692` + `277f976` | green as of `main`. R3 currently green via `categories_awaiting_labels > 0`. |
| S1..S1h (`scripts/_probe_salary_s1.mjs`) | annualized-to-52 identity per (account, period), no worker on 2 accounts in one week, plus S1a-S1h supporting checks | PR #710 (salary p1) | verify against last local run. |
| S1i (`scripts/_probe_derive_pay_segments_s1i.mjs`) | for each of P6..P9, per account: `sum by rippling_id == sum by external_id` (naive vs dedup). **RED-BY-DESIGN vs raw**: measures the derive's INPUT; the derive dedups; writes are correct. Goes green on its own the first nightly Rippling stops re-issuing. | commit `e850fab` (2026-08-19) | red-by-design against raw; do not fix by editing probe. |
| S2..S7 + salary sentinel (`scripts/_probe_salary_s2.mjs`) | salary route + board wiring PART A (module-level); PART B optional via route call with `KPI_TEST_COOKIE` else `needs-gate`. Sentinel: CIN - OH P8 salary rows + amount-percent-of-budget frozen for PR body. | PR #714 (salary p2) | PART A green; PART B needs `KPI_TEST_COOKIE` or Vercel preview. verify. |
| Salary toggle acceptance (`scripts/_probe_kpi_salary_toggle.mjs`) | PART A code-read of Shell/SignalCards/StoryBlock/page/css; PART B Playwright render on `TEST_MODE=true` local (rendered CSS + DOM). | PR #718 (salary p3) | verify against last run. |
| `scripts/_probe_labor_budget_acceptance.mjs` | labor budget resolution (playbook 4.5). | earlier v0.7 work | verify. |
| `scripts/_probe_labor_plans.mjs` | supersede-vs-PnL plans. | earlier | verify. |
| `scripts/probes/_probe_work_location_ids.mjs` | one-shot lister for migration seed (distinct id/label pairs). | PR #713 lead-up | ad-hoc; not a standing probe. |
| `scripts/probes/_probe_before_state.mjs`, `_probe_after_state_projection.mjs` | snapshot/projection for PR #713 report. | PR #713 | one-shot; kept in-tree for the audit trail. |
| `scripts/probes/_probe_normalize_verify.mjs` | verify fixed normalizer produces non-null `amount` + `category_id` on raw JSONB. | PR #712 | one-shot; post-fix. |
| `scripts/probes/_probe_post_fix_report.mjs` | post-fix numeric snapshot (raw counts, actuals sum, category-map state, sub-account gate). | PR #712 | one-shot. |
| `scripts/probes/_probe_rippling_spend_*.mjs` | pre-fix payload spikes (payload shape, extra fields, attribution axes). | PR #705/#712/#713 lead-up | one-shot; kept for the audit trail. |

Sanity asserts (not a probe per se; hard-fail-at-write): `deriveActuals.js:557-578` - `hours_regular > 48`, total hours > 168, `|amount - sum(dollar buckets)| > 0.05` -> throw + first-10 dump. Nightly exits non-zero, no writes.

---

## 5. Sentinels

Frozen values that gate change. **Any PR that moves a sentinel stops.**

| sentinel | value | source | protects |
|---|---|---|---|
| Labor CIN - OH 06/29 | 113.98 hrs / 2.32 OT / $4,328.27 | PROJECT_DASHBOARD.md line 29 | labor derive + hash + presence + attribution correctness end-to-end. Reconciled to the cent against paystub. |
| Purchasing TBR - FL P8 gl 3200.1 | $39,373.74 | Kevin's spec (this handoff); route path `src/app/api/kpi/purchasing/route.js:220-243` computes it live. | billcom sync + derive + `chartOfAccountId -> account_number` mapping + class-site map + per-bill atomicity. |
| Salary CIN - OH P8 | percent-of-budget captured by `_probe_salary_s2.mjs:224-232` sentinel block; exact figure lives in the salary p2/p3 PR bodies. verify - see V40 work. | probe frozen for PR body | salary derive + EXEMPT gate + effective-date resolution + `annual_value/52` formula. |

Rule: if a build change moves any of these, stop and report before continuing.

---

## 6. Open items (ranked)

| # | item | notes |
|---|---|---|
| 1 | **V40 - salary math bugs + toggle polish + cold-load skeleton** | Two salary math bugs pending. verify current state - not obviously on a branch. Toggle wired in PR #718; +Salary label surfaces via `StoryBlock.js`. Cold-load skeleton not shipped. |
| 2 | **Purchasing Phase 2 board** | Phase 1 (data-only) closed in PR #707 + follow-ups. Board is Phase 2. Spec is in `docs/KPI_PURCHASING_PHASE1_SPEC.md` §3 (contract) and `docs/KPI_PURCHASING_MASTER.md`. Route `/api/kpi/purchasing` returns everything a board would need. |
| 3 | **Rippling category map curation** | ~57 unlabelled `category_id`s in `spend_category_map` (verify count via `SELECT count(*) FROM spend_category_map WHERE gl_line_code IS NULL`). Sync writes candidates on first observation (`ON CONFLICT DO NOTHING`); labelling is manual. R3 probe stays informational-green while `categories_awaiting_labels > 0`. |
| 4 | **Rippling `spend_transaction_zo` support ticket** | Parent object blocked; Rippling returns `400: Field with name purchase_location not found`. Ticket status: verify. Do NOT re-attempt in code. See `purchasing_rippling_sync.mjs:36-40`, `purchasing-1-schema.sql:644-647`. |
| 5 | **Invoice Capture durable delivery** | `invoice_capture_matched_pct` in coverage payload is `null` - "P0d audit lands separately" per `src/app/api/kpi/purchasing/route.js:356`. Audit not yet in tree. |
| 6 | **STL - FL flat-lined labor budget question for Sebastian** | STL - FL labor budget sits at an identical figure for P5..P9 while actuals vary. If the 2026 seed flat-lined labor it may have flat-lined purchasing too. Needs Sebastian. See `docs/KPI_PURCHASING_MASTER.md:153-155` for the numbers. |
| 7 | **PR #715: wire nightly salary derive** | `chore/rippling-sync-add-salary-derive` open. Adds the salary derive step to `rippling-sync.yml`. Currently the salary derive runs only manually. |
| 8 | **PR #705 Rippling Spend API spike** | open as `docs/rippling-spend-spike`. Landed in effect via PR #707/#712/#713; spike PR may be stale. verify. |
| 9 | **PR #634 kpi 8b draft** | still DRAFT from 2026-08-06. Superseded by the shipped 8b path (`kpi-8ba/8bb/8bc` migrations already on main). verify closable. |

---

## 7. How to run things

Env vars are presence-only; never echo `.env.local` contents. Local runs load env via `--env-file=.env.local` or via the intranet primary checkout's file (`~/dev/kitchfix-intranet/.env.local` - the purchasing scripts hardcode that path in comments; symlink from a worktree if needed).

Env homes:
| var | Vercel | GitHub secret | .env.local |
|---|---|---|---|
| `SUPABASE_URL` | yes | yes | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | yes | yes |
| `RIPPLING_API_KEY` | no (server-only in Actions) | yes | yes |
| `BILLCOM_PROXY_BASE` | no | yes | yes |
| `BILLCOM_PROXY_KEY` | no | yes | yes |
| `KPI_DERIVE_TEST_HOOKS` | never in prod | never | opt-in for local-only tests (see `deriveActuals.js:136-142`) |
| `TEST_MODE` | never | never (Playwright job sets it) | opt-in for local Playwright/probe (see purchasing route L367) |
| `KPI_TEST_COOKIE` | never | never | opt-in for PART B of `_probe_salary_s2` |

### Rippling raw sync + labor derive
```
node --env-file=.env.local scripts/rippling_sync.mjs --source=nightly
node --env-file=.env.local scripts/rippling_sync.mjs --source=manual --dry-run
node --env-file=.env.local scripts/derive_labor_actuals.mjs --source=nightly
node --env-file=.env.local scripts/derive_labor_actuals.mjs --source=manual --dry-run
node --env-file=.env.local scripts/derive_labor_actuals.mjs --source=manual --dry-run --force-age-hours=100
```
Workflow dispatch: `rippling raw sync + labor derivation`, inputs `source={nightly|backfill|manual}` and `dry_run={true|false}`.

### Salary derive
```
node --env-file=.env.local scripts/derive_salary_actuals.mjs --source=nightly
node --env-file=.env.local scripts/derive_salary_actuals.mjs --source=manual --dry-run
node --env-file=.env.local scripts/derive_salary_actuals.mjs --source=manual --window=fytd
```
No workflow yet - PR #715 open.

### bill.com sync
```
node --env-file=.env.local scripts/purchasing_billcom_sync.mjs --source=nightly
node --env-file=.env.local scripts/purchasing_billcom_sync.mjs --source=fytd --period=8
node --env-file=.env.local scripts/purchasing_billcom_sync.mjs --source=manual --dry-run
```

### bill.com one-shot re-derive (post code fix)
```
node --env-file=.env.local scripts/purchasing_billcom_rederive.mjs
node --env-file=.env.local scripts/purchasing_billcom_rederive.mjs --dry-run
```
Shares the `purchasing_billcom_sync` lock so it cannot race the sync.

### Rippling spend sync
```
node --env-file=.env.local scripts/purchasing_rippling_sync.mjs --source=nightly
node --env-file=.env.local scripts/purchasing_rippling_sync.mjs --source=manual --dry-run
```
Workflow dispatch: `purchasing sync (billcom + rippling spend)`, inputs `source`, `period` (only when `source=fytd`), `dry_run`.

### Probes
```
node --env-file=.env.local scripts/_probe_derive_pay_segments_s1i.mjs
node --env-file=.env.local scripts/_probe_salary_s1.mjs
node --env-file=.env.local scripts/_probe_salary_s2.mjs
TEST_MODE=true PLAYWRIGHT_BASE_URL=http://localhost:3001 node scripts/_probe_kpi_salary_toggle.mjs
```

### Migration apply ritual (mechanically gated by `migration-gate.yml`)

1. Open migration-bearing PR. `Migration gate` check goes RED (Job A detects added `docs/migrations/*.sql`).
2. Open Studio; run the SQL **one statement at a time**. Do not run the whole file as a single query - the post-flight `DO $$ ... END $$` blocks may raise before earlier statements land.
3. Run the verify probe if one exists for the migration (many migrations have inline post-flight checks; run those too).
4. Post the canonical comment on the PR from an OWNER account:
   ```
   Migration gate: applied in Studio: YES
   ```
   The matcher accepts any comment containing `applied in Studio: YES` from `author_association == 'OWNER'` (or `login` in `ALLOWED_CONFIRMERS` = `KitchFix-Intranet`, `k-fietek`).
5. Job B fires, resolves PR head SHA via pulls API, emits a `Migration gate` check_run on that SHA as `success`. Ruleset flips green.
6. Merge.

Per-SHA reset: any push re-runs Job A. Flip-and-merge cannot survive a push. See `.github/workflows/migration-gate.yml` header for the 2026-07-28 aggregation subtlety.

---

## 8. Working agreement as experienced

- **Stop-and-report over silent scope additions.** Extra columns, extra fields, extra behavior - surface and wait. Never add-and-explain-after. Bounces are for silent additions, not for asking.
- **Probes run at runtime, not "by construction."** If it isn't executed, it's `[code-read]` and needs a `needs-gate` for real acceptance.
- **Never truncate to reset.** No `TRUNCATE`; use DELETE + INSERT in the append-only-on-hash-change pattern. `TRUNCATE` privilege intentionally not granted (money-adjacent standing rule).
- **No client dollars or worker names in commits or PR bodies.** Sentinel figures are the only exception, and only in this doc.
- **Migration-gated PRs do not merge on construction alone.** The mechanical gate blocks; owner attestation `applied in Studio: YES` unblocks. Never bypass with admin override.
- **Report a FAIL before fixing it.** No silent hotfixes; the failure itself is the artifact.
- **Kevin merges, never you.** Push, open PR, wait.
- **`[code-read]` on any unexecuted claim.** "Ran and green" > "reads correct".
- **`needs-gate` when the environment cannot run the check.** Never assert green from inference.
- **Verify own env before gating Kevin.** New worktree checklist: symlink primary `.env.local` before running smokes.

---

## If you only read one section

Read **§2 Pipelines end-to-end** - it names every table, view, endpoint, filter, lock, and probe by exact identifier; from there you can navigate to any file in §1 and any failure mode in §3.
