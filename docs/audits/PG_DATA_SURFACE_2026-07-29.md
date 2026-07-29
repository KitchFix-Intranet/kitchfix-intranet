# PG Data-Surface Discovery - Decision 5 input

**Date:** 2026-07-29
**Source SHA:** `20f531f` (main HEAD; worktree `docs/decision-5-data-surface`)
**Method:** Read-only. Migration-file `[code-read]` across all `docs/migrations/*.sql`; consumer grep across `src/`; sanctioned Studio queries stated in-line for numbers the code alone cannot answer. **No inline `-e` service-role scripts.** Where a live count is needed, the Studio query is quoted verbatim so Kevin runs it once and drops the number in.
**Purpose:** Produce a menu Kevin and Chat pick from. This document does not choose the v1 tool set.
**Binding:** Read only. No writes, no migrations, no schema changes, no new views.
**Decision 2 carve-out:** People Portal PAF wage and reimbursement data is excluded from the v1 tool surface entirely. Not surveyed here. `submissions` table not enumerated.

---

## Headline

- **Decline-log volume: insufficient for a demand ranking today** (Section 1). Sous has been live to SLT + corporate for four days; anything the log shows is signal about who tried, not about what operators will demand at scale. The wishlist (plan v2.53 Decision 5 row) is doing the work.
- **34 tables in scope; 9 views.** The Decision 2 carve-out plus OPD-already-covered plus sousai_questions removes ~4 items; `submissions` (People PAF) is not enumerated. Details in Section 2.
- **The view surface is uneven.** SC has three purpose-built views including one (`sc_daily_revenue`) that flattens the four load-bearing SC tables into a single queryable grain - exactly the leverage requirement 2 names. Inventory has six views but the module is parked. Invoice / Vendor / Directory have zero purpose-built views (Section 3).
- **Recommendation for v1 (Section 6): SC-only.** `sc_daily_revenue` + `sc_month_summary` + one homestand-aware lookup covers most of the wishlist's ranked-by-value candidates and lands the temporal-parameter requirement natively. Invoice and Directory candidates carry data-quality traps that would produce a confident wrong number before they produce operator value. Detailed reasoning below.

---

## Section 1 - What people actually ask and get declined on

### The decline log

`sousai_questions` (`pr-7-18-sousai-question-log.sql`) captures every question the agent handles. Relevant columns for demand analysis:

- `question` - the user's asked text
- `status` - resolved final state (grounded / declined / partial / etc.)
- `declined` - boolean, true when the agent declined to answer
- `decline_reason` - short code for why (out-of-corpus, safety, etc.)
- `answer` - the produced answer if any
- `latency_ms`, `token_burst_ms`, `usage` - performance metadata
- `feedback` / `feedback_comment` - thumbs signal
- `created_at`, `user_email` - who and when

### Studio queries for the decline log

Kevin runs these; state the counts back to Chat.

**Q1.1 - Volume by day since Sous went live:**

```sql
SELECT DATE_TRUNC('day', created_at)::DATE AS day,
       COUNT(*) AS total_questions,
       COUNT(*) FILTER (WHERE declined) AS declined_count,
       COUNT(*) FILTER (WHERE status = 'partial') AS partial_count
FROM sousai_questions
WHERE created_at >= '2026-07-25'
GROUP BY 1
ORDER BY 1;
```

**Q1.2 - Decline reasons histogram:**

```sql
SELECT decline_reason,
       COUNT(*) AS n,
       ARRAY_AGG(question ORDER BY created_at DESC) FILTER (WHERE row_number() OVER (PARTITION BY decline_reason ORDER BY created_at DESC) <= 3) AS recent_examples
FROM (
  SELECT decline_reason, question, created_at,
         ROW_NUMBER() OVER (PARTITION BY decline_reason ORDER BY created_at DESC) AS rn
  FROM sousai_questions
  WHERE declined = TRUE
) t
GROUP BY decline_reason
ORDER BY n DESC;
```

(If the row-number FILTER syntax gives friction, split into two queries: one for counts by decline_reason, one for LEFT JOIN examples.)

**Q1.3 - Partial-answer questions with feedback:**

```sql
SELECT question, decline_reason, feedback, feedback_comment, created_at
FROM sousai_questions
WHERE status IN ('declined','partial')
ORDER BY created_at DESC
LIMIT 100;
```

### Honest volume verdict

Sous went live 2026-07-25 (four days ago) and is gated to SLT + corporate. At best a few hundred questions; realistically dozens. **The log cannot carry a demand ranking today.** A decline-reason histogram over ~30 rows is a set of stories, not a distribution.

**What would settle it:** two weeks of prod usage at post-launch cadence, then re-run Q1.2 and Q1.3. Until then, **the wishlist is the demand signal** and Chat's rC review is the qualitative complement.

### The wishlist (plan v2.53, Decision 5 row) drives the menu

Directory, inventory, periods/homestands, all SC projections + actuals, period financial data (in-build), invoices, vendors. Treated as a starting list, not a boundary. Section 4 evaluates each; Section 6 recommends what to keep for v1.

---

## Section 2 - Table and view inventory

**In scope:** 34 base tables + 9 views, minus the carve-outs enumerated below.

### Excluded from further analysis

| Item | Reason |
|---|---|
| `submissions` (People PAF, Supabase-side DDL, not in migrations) | Decision 2 carve-out |
| `documents`, `document_relationships`, `document_surfaces`, `document_issues`, `document_pins`, `document_content`, `document_chunks` | Already served by Sous's existing document tools (searchDocuments, getDocument, listDocuments); Phase F is about operational data, not docs |
| `sousai_questions` | The tool log itself. Building tools that read the tool log is a Phase G item, not Phase F |

### Base tables in scope (28)

Split by module. Row counts require Studio (Q2.0 below).

**Q2.0 - Row counts and last-write timestamps for every in-scope table (single query):**

```sql
SELECT
  c.relname                                    AS table_name,
  c.reltuples::BIGINT                          AS approx_rows_planner,
  (SELECT COUNT(*) FROM ONLY inventory_items)  AS ...
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;
```

For exact counts, iterate table names:

```sql
SELECT 'inventory_items' AS table_name, COUNT(*) FROM inventory_items UNION ALL
SELECT 'count_items',      COUNT(*) FROM count_items UNION ALL
-- ...one row per table in the inventory below.
```

#### Vendor (module cut over to PG; live and read-primary)

| Table | Temporal columns | Growth shape | App consumers | Notes / traps |
|---|---|---|---|---|
| `vendors` | `created_at`, `deleted_at` | Slow, per-vendor add (rare) | 6 files (vendor portal + invoice pipeline) | Soft-deleted via `deleted_at IS NOT NULL`; **every read must filter** or vendor lookups return retired entries |
| `vendor_aliases` | none | Slow, alias-per-vendor | 2 files | Alias-to-canonical mapping; small |
| `vendor_accounts` | none | Slow | 1 file | Vendor-account link |

#### Invoice / AR (module cut over to PG; live)

| Table | Temporal columns | Growth shape | App consumers | Notes / traps |
|---|---|---|---|---|
| `invoice_submissions` | `submitted_at`, `invoice_date` | Per-day (a few submissions to dozens) | 2 files | `total_amount NUMERIC(12,2) NOT NULL` reliable; `invoice_number_normalized` GENERATED column for dedup; `corrected_from_uuid` self-FK for correction chains |
| `invoice_rejections` | `created_at` | Rare | 1 file | Reject-then-resubmit workflow |
| `ai_line_items` | `invoice_date`, `created_at` | Per-invoice fan-out | 2 files | **Trap:** `data_provenance` distinguishes `app_scan` / `batch_rebuild` / `manual_entry` / `unknown`; historical rows can have NULL `invoice_uuid` with `historical_invoice_ref` populated - naive JOIN to `invoice_submissions` drops historicals |
| `gl_codes` | `created_at` | Static | 1 file | GL code lookup |

#### Directory (Supabase-side DDL, not in migrations dir)

| Table | Temporal columns | Growth shape | App consumers | Notes / traps |
|---|---|---|---|---|
| `accounts` (Supabase-side DDL) | expected `created_at` | Static (~15 accounts) | 2 files (directory + directory API) | **Column set not verified from migrations** - Kevin should Studio-run `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'accounts'` before any tool ships |
| `hero_images` (Supabase-side DDL) | unknown | Small | 1 file | Not decision-relevant |

#### Service Calendar (module cut over to PG; live and read-primary)

| Table | Temporal columns | Growth shape | App consumers | Notes / traps |
|---|---|---|---|---|
| `sc_service_groups` | `created_at`, `updated_at`, `deleted_at` | Static (config; ~10 groups per account) | 2 files | Soft-delete filter needed |
| `sc_services` | `created_at`, `updated_at`, `deleted_at` | Static (config; ~20-50 per account) | 3 files | Soft-delete filter needed |
| `sc_service_prices` | `effective_date`, `created_at` | Slow (per price change) | 1 file | **Known trap (F8 audit):** no `account_key` column - must join via `sc_services.id → sc_service_prices.service_id`. Direct `WHERE sc_service_prices.account_key = ?` is impossible |
| `sc_daily_projections` | `service_date`, `created_at` | Per-day per-account (~365 * n_services rows/year) | 2 files | Primary key `(account_key, service_id, service_date)` - deterministic |
| `sc_daily_actuals` | `service_date`, `created_at` | Per-day per-account | 1 file | Same shape as projections |
| `sc_daily_actuals_history` | `service_date` | Per-actual-write | 0 read files in src/ | Append-only audit log; not for tools |
| `sc_day_metadata` | `service_date`, `created_at` | Per-day per-account | 3 files | Carries `period`, `week_label`, `event_label`, `game_type`, `game_time`, `notes` - the "context" side of a day |
| `sc_homestand_schedule` | `service_date`, `created_at` | Per-day per-account | 5 files | Homestand membership per date |
| `sc_config_changelog` | `changed_at`, `effective_date` | Per config change (few per week) | 2 files | Audit trail of price / service edits |
| `sc_labor_budgets` | `effective_date`, `created_at` | Per-period per-account | 1 file | Period-shaped (`period ~ '^P([1-9]|1[0-3])$'`) |
| `sc_phase_calendar` | `start_date`, `end_date`, `created_at` | Static per season (~13 periods per account) | 1 file | The period-boundary table; feeds "what period are we in" |
| `sc_day_note_entries` | `service_date`, `created_at` | Sparse | 2 files | Free-text day notes; presence signal |
| `sc_fee_schedule` | `effective_date`, `created_at` | Slow (per fee change) | 2 files | Per-account fee negotiation history |
| `sc_homestand_closeout` | (2026-07-29 ruling; new) | Per homestand | 1 file | Post-homestand summary rows |

#### Inventory (Smart Inventory - module PARKED)

| Table | Temporal columns | Growth shape | App consumers | Notes / traps |
|---|---|---|---|---|
| `inventory_items` | `updated_at` | Static-ish (~1500 items) | 1 file | Parked module; cron writes but no active UI |
| `item_aliases` | none | Slow | 1 file | Alias map |
| `storage_locations` | `created_at` | Static | 1 file | Zone list |
| `count_sessions` | `period` (TEXT), `submitted_at`, `created_at` | Per-count-session (~1 per week per account when active) | 1 file | `period` is TEXT ("P1".."P13") - not comparable to SC's period vocabulary; **cross-module period compares would be a trap** |
| `count_items` | `saved_at` | Fan-out per session | 1 file | The count fact table |
| `price_history` | `effective_date`, `created_at` | Per-price-change | 1 file | Per-item price snapshot |
| `review_queue` | `invoice_date`, `created_at` | Queue-shaped | 1 file | Review workflow |
| `merge_history` | `created_at` | Rare | 1 file | Item-merge audit |
| `merge_history_items` | none | Per-merge fan-out | 1 file | Sub-rows |

### Views in scope (9)

**Q2.1 - Row counts per view:**

```sql
SELECT 'sc_daily_revenue', COUNT(*) FROM sc_daily_revenue UNION ALL
SELECT 'sc_month_summary', COUNT(*) FROM sc_month_summary UNION ALL
SELECT 'sc_changelog_latest_by_account', COUNT(*) FROM sc_changelog_latest_by_account UNION ALL
SELECT 'v_count_session_totals', COUNT(*) FROM v_count_session_totals UNION ALL
SELECT 'v_current_count_items', COUNT(*) FROM v_current_count_items UNION ALL
SELECT 'v_current_count_state', COUNT(*) FROM v_current_count_state UNION ALL
SELECT 'v_inventory_items_full', COUNT(*) FROM v_inventory_items_full UNION ALL
SELECT 'v_price_history_ranked', COUNT(*) FROM v_price_history_ranked UNION ALL
SELECT 'v_price_movers', COUNT(*) FROM v_price_movers;
```

Detailed per-view assessment in Section 3.

### Join traps (beyond the known `sc_service_prices` case)

Method: `[code-read]` every FOREIGN KEY across migrations, plus check every table for absence of an obvious FK to accounts/service_date/period.

| # | Trap | Where | What goes wrong |
|---|---|---|---|
| 1 | **`sc_service_prices` no `account_key`** (known) | `sc-1-service-calendar-schema.sql:200` area | Callers must join `sc_service_prices → sc_services.id` first, then filter by `sc_services.account_key`. Direct `WHERE sc_service_prices.account_key = ?` compiles and returns zero. F8 audit already caught this |
| 2 | **`ai_line_items` historical rows have NULL `invoice_uuid`** | `pr-6-1-invoice-schema.sql:154-160` | Naive INNER JOIN to `invoice_submissions` silently drops all historical rebuild rows. Use LEFT JOIN or filter on `data_provenance = 'app_scan'` |
| 3 | **`vendors.deleted_at` not filtered** | `pr-5-1-vendor-schema.sql:44` | A vendor lookup that ignores `deleted_at IS NULL` will return retired vendors. The unique-name partial index only enforces uniqueness among non-deleted; deleted names can collide |
| 4 | **`sc_services.deleted_at` and `sc_service_groups.deleted_at` not filtered** | `sc-1-service-calendar-schema.sql:74, 105` | Deleted services still exist in the table; must filter every join. `sc_daily_revenue` already handles this internally |
| 5 | **`count_sessions.period` vs SC's period vocabulary** | `inv-1-smart-inventory-schema.sql` | Both use `P1..P13` strings but the phase-calendar boundaries only exist in SC. A cross-module period comparison is a naming coincidence, not a semantic match |
| 6 | **`sc_daily_actuals` FILTER (WHERE has_actuals)** | `sc_daily_revenue` view internals | A day with a projection but no actual has `actual_count = NULL`, not 0. `SUM(actual_count)` treats NULL as 0 - correct for aggregation, dangerous if used to gate "was this day worked" |
| 7 | **`invoice_submissions.corrected_from_uuid` correction chain** | `pr-6-1-invoice-schema.sql:80` | A total-spend query that sums every row double-counts corrections. Filter on `corrected_from_uuid IS NULL` OR aggregate on a materialization that resolves the chain |
| 8 | **`accounts` schema unknown from migrations** | (Supabase-side DDL) | Any tool that reads `accounts` must ship after Kevin verifies column set. Silent assumption of `active` or `deleted` columns is a trap. |

---

## Section 3 - Existing views, as the design surface

Requirement 2 says views are the primary design surface. Assessment: **three of nine views are load-bearing candidates for Phase F; the other six either don't apply (Decision 2), sit in a parked module, or are utility helpers for admin surfaces.**

### `sc_daily_revenue` - the star of the survey

**What it answers:** For every `(account_key, service_id, service_date)` on which SC has either a projection or an actual, returns:
- `service_name`, `group_name`, `is_flat_fee`, `is_tax_free`, `is_non_revenue`
- `projected_count`, `actual_count`, `has_actuals`, `has_projection`
- `price_at_date`, `price_effective_date`
- `projected_revenue`, `actual_revenue` (both = count * price)
- `period`, `week_label`, `event_label`, `game_type`, `game_time`, `day_notes` (via `sc_day_metadata`)

**Grain:** row per (account, service, service_date).

**Row count:** Studio Q2.1.

**Temporal dimension:** `service_date` DATE, native. Every operator temporal question (this week / this homestand / this period / this month / current season) filters on it.

**Distinct questions it could serve as-is** (before we build one tool):
1. "What's [account]'s projected vs actual revenue for [date range]?"
2. "Which services drove [account]'s revenue variance this [period]?"
3. "How many meals is [account] booked for on [homestand]?"
4. "What's [account]'s current in-season price for [service]?"
5. "Which days in [range] had actuals entered vs missing?"
6. "What's this month's revenue variance across the portfolio?" (aggregate all accounts)

Six distinct question shapes, one view. This is the view that justifies the "views are the design surface" requirement.

**Traps:** Already handled internally (soft-delete filter, projected/actual UNION, price-as-of-date LATERAL JOIN). Caller-side: the `sc_service_prices` join trap is already resolved inside the view - no caller re-implements it.

### `sc_month_summary` - pre-aggregated dashboard rollup

**What it answers:** For every (account_key, month), returns totals: service days, days with actuals, projected meals, actual meals, projected revenue, actual revenue, revenue variance.

**Grain:** one row per (account, month).

**Row count:** Studio Q2.1. Small - single-digit accounts times 12 months per season.

**Temporal dimension:** `month DATE`, derived via `DATE_TRUNC('month', service_date)`.

**Distinct questions:**
1. "What's [account]'s YTD revenue?"
2. "What's this month's revenue variance?"
3. "Are actuals-entry rates trending?"

Fewer than sc_daily_revenue but tighter aggregate.

**Traps:** Aggregates over `is_non_revenue` correctly excludes Fun Money and similar; a caller who wants ALL meals (revenue + non-revenue) must go back to `sc_daily_revenue`.

### `sc_changelog_latest_by_account` - utility

**What it answers:** For each `account_key`, the most recent `changed_at` in `sc_config_changelog`.

**Grain:** one row per account.

**Row count:** ~ number of accounts.

**Distinct questions:** 1 ("when was [account]'s config last touched"). Admin surface material, not operator-facing. **Skip for Phase F.**

### Inventory views (`v_*`)

Six views over the parked inventory module: `v_current_count_state`, `v_current_count_items`, `v_count_session_totals`, `v_inventory_items_full`, `v_price_history_ranked`, `v_price_movers`.

**What they answer:** Current inventory zone state, top price movers, latest counts per item.

**Assessment:** The module is parked (v2 vision is queries-over-facts with no cron). Wiring a Sous tool against a parked module bets on when v2 lands. **Defer to v2.**

### View-shaped leverage not yet built

Requirement 2 asks where a new view could collapse question shapes. Two candidates surfaced during the survey:

**Candidate V-1 - `v_current_homestand_by_account`:**
Given today's date + `sc_homestand_schedule`, return the current homestand (or the next / previous). No view exists; every caller re-derives via `WHERE service_date <= today ORDER BY service_date DESC LIMIT 1` per account. A view here would collapse "current homestand", "next homestand", "how many days into this homestand" into one lookup.

Effort to build: **small** (30-line CREATE VIEW). Kevin rules; not in this PR.

**Candidate V-2 - `v_period_current_by_account`:**
Same shape but over `sc_phase_calendar`. Every tool that needs "which period are we in for [account]" repeats the interval check. A view collapses that.

Effort: **small.** Kevin rules; not in this PR.

**Candidate V-3 - invoice-with-corrections-resolved:**
A view over `invoice_submissions` that materializes the `corrected_from_uuid` chain and exposes only the latest version of each invoice. Every naive total-spend query that hits `invoice_submissions` risks double-counting corrections without this. Effort: **medium** (recursive CTE). Kevin rules; not in this PR.

---

## Section 4 - The candidate menu

Grouped by domain. Wishlist items in order, plus items the data surfaces.

### SC-1 - Account revenue and variance snapshot

| Field | Value |
|---|---|
| Question it answers | "How is [account] tracking this month / this homestand / this period?" |
| Source | `sc_month_summary` view (for month grain) + `sc_daily_revenue` view (for homestand or period grain) |
| Parameters | `account_key` (required); `window` enum (`month` / `homestand` / `period` / `custom`) - defaults to current-period; `as_of DATE` (optional; defaults today) |
| Result shape | Aggregate. Row cap: N/A - always returns a single record set summary |
| Effort | **Small.** Single-view read, JS-side aggregation for homestand/period grouping |
| Traps | Do NOT expose `total_actual_revenue` for a partial-month window without also stating `days_with_actuals` / `total_service_days` so the operator sees the fraction. **Present partial as partial.** |
| Season scope | Current-season only via `as_of`. Requirement 5 satisfied by param default |

### SC-2 - Homestand-scoped projected vs actual

| Field | Value |
|---|---|
| Question it answers | "What's projected vs actual on [account]'s current homestand?" (or "next", or "the one that started 2026-07-25") |
| Source | `sc_daily_revenue` view filtered by `sc_homestand_schedule` join |
| Parameters | `account_key` (required); `homestand_ref` (enum: `current`, `next`, `previous`, or explicit date) |
| Result shape | Rows per (service_date, service_name). Row cap: 200 (a homestand is ~10 days x ~20 services) |
| Effort | **Small.** Filter + group. Requires the join to homestand_schedule to compute "current" |
| Traps | Homestand membership can span two months - do not group by month inside this tool. Also `has_actuals=false` days should render distinctly, not as zero |
| Season scope | Current-season by default via `homestand_ref=current`. `previous` / explicit-date support historical within-season |

### SC-3 - Period pace (retention question)

| Field | Value |
|---|---|
| Question it answers | "Where does [account] sit in [period] against its own history / against a peer account?" |
| Source | `sc_daily_revenue` + `sc_phase_calendar` |
| Parameters | `account_key`, `period` (defaults current), `comparison` (self-last-period / peer_account_key / null) |
| Result shape | Small aggregate per period; row cap N/A |
| Effort | **Medium.** Period boundary lookup + comparison logic |
| Traps | Cross-account peer comparison assumes similar operational shape; a PDC vs MLB peer compare is meaningless. Enforce peer-selection guard at the tool boundary. Also `sc_phase_calendar` grain unclear until Studio-verified (see Q2.1) |
| Season scope | Requirement 5: current season only unless historical param explicitly set. History-vs-history comparisons are Phase G at earliest |

### SC-4 - "What's the price of [service]?"

| Field | Value |
|---|---|
| Question it answers | "What's [account]'s current price for [service_name]?" |
| Source | `sc_service_prices` JOIN `sc_services` (per the F8-known trap) |
| Parameters | `account_key`, `service_name_or_id`, `as_of DATE` (optional; defaults today) |
| Result shape | Aggregate: current price + effective_date + change history (if `include_history=true`) |
| Effort | **Small.** Two-table join with as-of ranking |
| Traps | The F8 trap (no `account_key` on `sc_service_prices`); the tool must implement the join, not the model. Also `deleted_at` filter on `sc_services` |
| Season scope | Universal - prices apply across seasons; the temporal parameter is `as_of` |

### INV-1 - Total spend by category / vendor for a period

| Field | Value |
|---|---|
| Question it answers | "How much did [account] spend on [category] in [period]?" or "What's [vendor]'s YTD invoice total for [account]?" |
| Source | `ai_line_items` aggregated (optionally joined to `invoice_submissions`) |
| Parameters | `account_key` (required); `category` OR `vendor_name` (either); temporal window (`period` / `month` / `date_range`) |
| Result shape | Aggregate: total dollars + line count + optional breakdown |
| Effort | **Medium.** Category aggregation is straightforward; corrections handling is the risk |
| Traps | **Trap #7 above** - naive sum double-counts corrections. Tool must filter `invoice_submissions.corrected_from_uuid IS NULL` or use candidate view V-3. **Trap #2** - historical `ai_line_items` have NULL `invoice_uuid`; decide inclusion policy per tool ruling. Category taxonomy is 10 buckets but OCR confidence varies - present "approx" markers where confidence is low |
| Season scope | Fine for current-season; season-crossing is a caller-side concern (no season column - use date range) |

### INV-2 - "What did we buy from [vendor] last [window]?"

| Field | Value |
|---|---|
| Question it answers | "What line items landed from [vendor] between [date1] and [date2]?" |
| Source | `ai_line_items` filtered by vendor_name |
| Parameters | `vendor_name_or_id`, `date_from`, `date_to`, `account_key` (optional filter) |
| Result shape | Rows. Row cap: **200 explicit** with a "showing N of M" indicator, per requirement 1 |
| Effort | **Small.** Filter + order + limit |
| Traps | Vendor name spelling variance across invoices (`vendor_aliases` mitigates but not perfectly); the tool should resolve via alias table first |
| Season scope | Current season by default; explicit dates permit historical |

### DIR-1 - Account directory lookup

| Field | Value |
|---|---|
| Question it answers | "What's the current account list?" or "Who owns [account]?" |
| Source | `accounts` table (Supabase-side DDL) |
| Parameters | Optional `account_key` filter; optional `active_only=true` |
| Result shape | Aggregate (single account) or rows (list, capped) |
| Effort | **Small once schema is verified.** The `accounts` column set was not verified from migrations - **Kevin's Studio run required before this tool ships** |
| Traps | Schema unknown from migrations; retention of retired accounts unknown. Any tool assuming "active=TRUE" filter without verifying is a data-quality trap |
| Season scope | Cross-season |

### HS-1 - Current homestand / period lookup

| Field | Value |
|---|---|
| Question it answers | "What homestand is [account] on?" or "What period are we in for [account]?" |
| Source | `sc_homestand_schedule` + `sc_phase_calendar` |
| Parameters | `account_key`, `date` (optional; defaults today), `scope` enum (`homestand` / `period`) |
| Result shape | Aggregate; a small object with boundaries + label + days-in / days-remaining |
| Effort | **Small.** Two lookups; interval math in JS |
| Traps | `sc_phase_calendar.start_date` / `end_date` need Studio verification for grain (per-account vs global). If per-account, that's fine; if global, needs to be joined differently |
| Season scope | Current-season only (temporal by construction) |

### DEFERRED - period financial data (in-flight)

Wishlist item. **Not yet built** per plan v2.53 - "period financial data still being built in July." No PG table today. Do not wire until it exists.

### DEFERRED - all inventory tools

Wishlist item. Parked module. Six views exist; the module's v2 vision is "queries-over-facts with no cron" and would rebuild the shape. Do not wire against the current tables.

---

## Section 5 - What to deliberately leave out

Beyond the Decision 2 carve-out:

### 1. Documents-as-data

The document catalog (`documents`, `document_relationships`, etc.) is already served by Sous's existing document tools. Building a Phase F tool that reads the same tables under a different name creates two answer surfaces for the same question - and Sous will pick between them semantically, which is worse than either alone.

### 2. Inventory (parked module)

Six inventory views are technically queryable but the module is on v1 that Kevin already ruled over-built. Building a Sous tool against inventory means either committing to v1 forever or agreeing to rewrite the tool when v2 lands. Wait for v2.

### 3. Sheets-only modules (labor, financial legacy, incidents, dugout, legacy inv count)

These modules have not cut over to PG. Phase F reads PG. A Sous tool reading Sheets is a different architecture (Google Sheets API rate limits + auth model) and out of Decision 5 scope. When they migrate, they enter the menu.

**Specifically for `financial` (the Sheets-only P&L legacy):** operators will ask "what's this period's P&L for [account]" and the natural answer surface is on Sheets today. **Do not** build a PG-side approximation from `sc_daily_revenue` + `ai_line_items` - it will disagree with the Sheets-based finance report and someone will trust the wrong one.

### 4. `sousai_questions` (self)

Building a Sous tool that reads Sous's own log is a Phase G feature at earliest (self-audit surface). Not v1.

### 5. `sc_daily_actuals_history` and audit-log tables

Append-only audit trails (`sc_daily_actuals_history`, `merge_history_items`, `sc_config_changelog` as a raw feed) are ops-forensics data, not operator questions. Skip.

### 6. Aggregations Chat can do better on the day

The line-item category breakdown "how much did we spend on packaging in P4" is answerable, but a monthly finance email covers the same ground with more context. If the answer is already in a routine artifact, exposing a tool that races it can create disagreement.

Section 5 is deliberately non-empty. Ruling six things out prevents six bad tools.

---

## Section 6 - Recommendation on v1 scope

**Marked as a recommendation, not a decision.**

### Ship in v1 (three tools)

**T1 - `sc-account-window` (from candidate SC-1 + SC-2).** Merged: one tool with a `window` param that covers month / homestand / period grain. Reads `sc_month_summary` for month; `sc_daily_revenue` for finer grain; joins `sc_homestand_schedule` for homestand membership. Native temporal parameter, single view surface, four wishlist items answered.

**T2 - `sc-service-price` (from candidate SC-4).** The as-of price lookup with proper join through `sc_services`. Small, self-contained, closes the "what does [service] cost at [account] today" class of question with the join trap encapsulated.

**T3 - `sc-homestand-context` (from candidate HS-1).** "What homestand / period is [account] on right now?" - the temporal-orientation tool the other two lean on and every SC question presupposes.

**Why these three:**
- Every one has a native temporal column (`service_date`).
- Every one reads through a view or through the F8-mitigated join.
- Traps are all inside the tool boundary, not caller-visible.
- Together they cover the SC + homestand slice of the wishlist.
- v1 stays small enough to instrument and eval-tune before adding more.

### Defer to v1.1

**Directory (DIR-1)** - only after Kevin Studio-verifies the `accounts` schema. Then it's small and safe.

**Homestand-current view (candidate V-1)** and **period-current view (candidate V-2)** - build if the T3 tool's ad-hoc join is loose. Building these views would let T3 (and every future SC tool) share one interval lookup.

### Explicitly defer

- **Invoice (INV-1, INV-2).** The corrections chain trap (candidate view V-3 needed) means shipping this before the view is a "confident wrong number" risk. The category-taxonomy OCR confidence adds a second uncertainty. Both are solvable but not v1.
- **Period financial data.** Not built.
- **Inventory** - see Section 5.
- **People PAF** - Decision 2 carve-out.
- **Cross-account peer comparisons** (part of SC-3). Requires operational-shape guards to be meaningful; premature.

### Where I have no strong view

- Whether `sc_month_summary` covers enough grain to skip `sc_daily_revenue` for a first tool. My read: no - operators think in homestands, not months. But if usage post-launch shows month questions dominate, T1's implementation can pivot to month-first and reveal daily behind a flag.
- Whether V-1 / V-2 (the homestand-current / period-current views) should ship *with* v1 or *after* T3 hits friction. Building them is small; not building them means T3 embeds the interval lookup twice.

### Insufficient evidence for

- Any prioritization ranking that depends on operator demand. The four-day decline log cannot support a ranking. **What would settle it:** two weeks of prod usage; re-run Q1.2 and Q1.3.
- Whether "period financial data" belongs in Phase F at all vs. staying in Sheets-native reporting. That's a Kevin ruling on where operators expect the answer to live.

---

## Section 7 - How to re-run this survey

Copy-paste discipline aid.

### Section 1 - decline log queries

Q1.1, Q1.2, Q1.3 above.

### Section 2 - inventory queries

**Q2.0 - list every public table with a rough row count:**

```sql
SELECT c.relname AS table_name, c.reltuples::BIGINT AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```

**Q2.0-exact - exact row counts (paste table names):**

```sql
SELECT 'documents' AS t, COUNT(*) FROM documents UNION ALL
SELECT 'sc_daily_projections', COUNT(*) FROM sc_daily_projections UNION ALL
-- ...
```

**Q2.1 - view row counts:**

See Section 2 above.

**Q2.2 - accounts schema (Supabase-side DDL):**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'accounts'
ORDER BY ordinal_position;
```

**Q2.3 - verify no writes since survey:**

```sql
SELECT relname, n_tup_ins, n_tup_upd, n_tup_del, last_analyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;
```

### Section 3 - view definitions

```sql
SELECT schemaname, viewname, definition
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;
```

### Recomputing the join-trap set

`[ran]` `grep -rE "FOREIGN KEY|REFERENCES" docs/migrations/*.sql` and cross-check consumer joins:

```
grep -rE "\.from\('sc_service_prices'\)" src/lib/
grep -rE "\.from\('ai_line_items'\)" src/lib/
grep -rE "\.from\('invoice_submissions'\)" src/lib/
grep -rE "\.from\('vendors'\)" src/lib/
grep -rE "\.from\('sc_services'\)" src/lib/
```

---

## Notes on method

- **Zero writes.** No migrations, no views created, no data modified, no re-embeds.
- **No tools built.** This is discovery.
- **People Portal PAF wage and reimbursement domain not surveyed at all.** `submissions` table not enumerated.
- **No `.env*` opened.** No inline `-e` service-role scripts - the classifier declined the pattern twice this arc and that ruling stood. Section 1 numbers require Kevin's Studio run; queries provided.
- Migration-source enumeration is authoritative for what shipped. The `accounts` table's DDL lives Supabase-side and is not covered by any migration in this repo; the Q2.2 query is the only way to know its shape.
- The candidate menu should be treated as consequences of the temporal / view / trap analysis above, not as an independent list. Any candidate that removes a trap section removes itself.
