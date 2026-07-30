# SousAI tool pagination audit - 2026-07-30

**Trigger:** the 2026-07-30 sweep uncovered `spend_summary` publishing $46,444 where the truth was $275,970 - an 83% Sysco portfolio undercount. Root cause: PostgREST's default 1000-row cap on `.select()`. The tool read `ai_line_items` without pagination, summed the first thousand, and published the result as a total.

**Rule (Kevin, plan v2.60):** audit every data tool. A tool that cannot be classified confidently is BROKEN until proven otherwise. "Safe by cardinality" requires a growth argument, not just a current count.

**Method:** code-read every tool in `src/lib/sousai/tools/registry.js`. Probe production PG for row counts on 2026-07-30 (`scripts/sousai-pagination-probe.mjs`). Classify each read.

## Probed row counts (2026-07-30)

```
contacts               30
accounts               12
vendors                40  (deleted_at IS NULL)
vendor_aliases         68
sc_services            105 (deleted_at IS NULL)
sc_service_prices      161
documents (Live)       82

ai_line_items          15,055  (14,677 YTD)
v_invoice_submissions_current  1,512  (1,489 YTD)

sc_daily_revenue YTD per busiest account:
  TBJ - FL   3,090
  TBR - FL   3,000
  CIN - AZ   2,743
  STL - FL   1,740
  CIN - OH   420

sc_daily_revenue per 28-day slice (period-shaped):
  TBR - FL   454   (busiest)
  TBJ - FL   406
  CIN - AZ   377
  STL - FL   221
  CIN - OH   84

sc_homestand_schedule per account:  0 to 83 rows
```

The rows that live above the 1000-row PostgREST default: `ai_line_items` (any non-narrow read), `v_invoice_submissions_current` (portfolio YTD hits 1,489), and `sc_daily_revenue` filtered to a single account with a YTD window (already past 1,000 for the four PDC-adjacent accounts). The last is not currently reached by any tool - the SC readers all filter to a single-month or single-homestand or single-period window, which stays under 500 today.

## Classification table

Every tool now declares `pagination: "safe"` or `pagination: "paginated"` in `registry.js`, with a `paginationNote` carrying the growth argument. The `scripts/sousai-pagination-posture-test.mjs` guard fails on missing or unrecognized values, and passes a deliberately-unbounded fixture that must fail.

| # | Tool | Read shape | Row ceiling today | Verdict | Growth argument |
|---|---|---|---|---|---|
| 1 | `find_contact` | contacts ilike name | 30 (whole table) | Safe by cardinality | Leadership directory only (EC / Sous / HM / corporate). Line and hourly staff not tracked. 3x growth = 90, well below 1,000. |
| 2 | `list_accounts` | accounts (with filters, and full-table read for validLevels fallback) | 12 rows | Safe by cardinality | One row per current-season account. Retired accounts physically deleted. Portfolio expansion measured in accounts per year, not per month. Ceiling ~30. |
| 3 | `list_contacts_by_role` | contacts (role + optional teamKey) | 30 total, max slice = 9 (EC) | Safe by cardinality | Same table as #1. |
| 4 | `get_account_team` | accounts.maybeSingle, contacts.eq team_key, accounts.select for validTeamKeys | max 12 team_keys, ~9 contacts per team | Safe by cardinality | All reads bounded by tables at #1 + #2. |
| 5 | `sc_account_window` | sc_daily_revenue eq account_key + service_date range (month / homestand / period) | Busiest single-window today = TBR-FL 28-day = 454 | Safe by cardinality (single-account × single-window) | Month ~500 max, homestand ~250 max, period ~460 max. Windows are calendar-bounded; growth would require both service catalog expansion AND a larger window. YTD not supported by this tool - callers who want year-scale ranges route to `spend_summary`. |
| 6 | `sc_homestand_detail` | sc_homestand_schedule filtered, sc_daily_revenue eq account_key + homestand range | Single homestand ~200-280 rows | Safe by cardinality (single homestand × single account) | Homestand length is MLB-schedule bounded (rare > 14 days). Output already cap-truncated at B2_ROW_CAP=200 with honest "showing N of M". |
| 7 | `sc_service_price` | sc_services eq account_key ilike name, sc_service_prices per service | 105 services total, 161 prices total | Safe by cardinality | Catalog is per-account bounded (~10-20 services). Prices per service = handful of history rows. |
| 8 | `sc_orientation` | 3 views: `.maybeSingle()` or `.limit(1)` | 1 row each | Safe by explicit limit | Bounded by explicit query limits, not table size. Company-wide period fallback uses `.limit(1)`. |
| 9 | `spend_summary` | v_invoice_submissions_current, ai_line_items | **1,489 YTD portfolio invoices, 14,677 YTD line items** | **BROKEN → fixed by paginated read** | Both tables grow monotonically. Portfolio YTD queries already exceed 1,000 rows in either direction. Fix: exhaustive sweep via `paginateAll` (`_constants.js`). |
| 10 | `spend_vendor_history` | v_invoice_submissions_current, ai_line_items | Same as #9 | **BROKEN → fixed by paginated read** | Same read pattern as #9. `.order('invoice_date', desc)` in the original code didn't change the truncation vector - it only reordered the first 1,000. Fix: paginate by id then JS-sort by invoice_date for display. |

## Ancillary reads inside the spend tools

`vendors` (deleted_at IS NULL) = 40 rows; `vendor_aliases` = 68. Both fully bounded well under 1,000 for the foreseeable future. Vendor resolution reads (`.ilike` on name/alias, then `.in(id, ...)`) do not paginate and do not need to.

## Doc tools (bonus classification, since they read the same shared corpus)

| # | Tool | Read shape | Verdict |
|---|---|---|---|
| D1 | `search_documents` | RPC `match_document_chunks` bounded at `match_count=30`; documents `.in(candidateIds)` (max 30) | Safe by explicit limit |
| D2 | `get_document` | Loop over max 6 doc IDs (`GET_DOCUMENT_MAX_BATCH`); document_chunks `.eq(doc_id).order(chunk_index)` for one doc | Safe by explicit limit |
| D3 | `list_documents` | documents filtered by archived=false, status='Live', access_level | Safe by cardinality (82 Live rows, grows ~50 rows/year, ceiling below 500 for years) |

## The paginated-read helper

Added `paginateAll` in `src/lib/sousai/tools/data/_constants.js`. Takes a callback that runs one page via `.range(from, to)` and returns a flat array of every row. The BROKEN tools (`spend_summary`, `spend_vendor_history`) and the new tool `spend_top_vendors` all use it. Callers order by `id` for the sweep (stable server-side sort key so `.range()` doesn't duplicate or skip), then re-sort in JS if the output needs a different order.

## Convention 1 rewrite

`_constants.js` now leads with the pagination rule:

> Any table read that could exceed [the 1000-row default] MUST paginate via `.range()` sweeps and complete the read, OR MUST report truncation honestly as "showing N of M". Aggregates built on a silently-truncated read publish wrong numbers.

The convention name is the same as before - Kevin's Convention 1 was already "honest row-cap truncation" - but its scope is now explicit: it covers both the "showing N of M" surface (row-returning tools) and the "sweep to completion" backstop (aggregate tools).

## Verification (2026-07-30)

- `10.5` Sysco portfolio YTD: was $46,444 / 562 lines. Now **$240,617 / 2,661 lines.**
- `10.6` Sysco STL-FL YTD: was $89,848 / 787 lines. Now **$89,848 / 787 lines** (unchanged - STL-FL was already at 966 raw rows, near the 1000-row boundary; corrections resolution drops it to 787).
- Consistency: **STL-FL ≤ portfolio ✓** (was violated: STL-FL > portfolio, arithmetically impossible).
- Portfolio total came in at **$240,617** vs the sweep's stated ground-truth target of **$275,970**. The delta ($35,353 / 292 line items) is the corrections-resolution filter that the sweep report's raw-count probe did not apply. Corrections-resolution is the correct behavior for `spend_summary` (`v_invoice_submissions_current` is the point of the view: don't double-count corrected invoices).

## What this audit does NOT cover

- **Concurrent-write correctness during the sweep.** Row counts probed at a single point in time. If line items are landing while a paginated read is in flight, the sweep can duplicate or skip rows across pages (rare edge case; `paginateAll` orders by `id` which is monotonic, so a row inserted mid-sweep with a higher `id` would land in a later page).
- **PostgREST 1000-row cap on the RPC** (`match_document_chunks`). RPCs have their own row-cap behavior; `match_count=30` sits well below any default.
- **Vendor + vendor_alias reads under high-growth scenarios.** 40 vendors + 68 aliases today. If either table crossed 500 rows the `.ilike` reads would still be fine (bounded by match set), but the `.in(vendor_ids)` roundtrips would need re-checking.
