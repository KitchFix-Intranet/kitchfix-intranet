# FIN-2027 Orientation + Technical Review - 2026-09-17

Branch: `audit/fin2027-orientation` · origin/main SHA at start: `65b4d6f0dfa289da7f84e25040839b7355fb8061`
Session type: read-only recon. No DB writes, no migrations, zero dollar figures in this file.

---

## 0. Plain-English summary

- The system that FIN-2027 will run against is real and working, but it was built assuming FY2026 is the only fiscal year in the world. The word `2026` appears as a hardcoded constant in the KPI resolver, in the labor route, and in several downstream helpers. Historical rows can sit next to FY2026 rows in `pnl_actuals` and `kpi_budgets` without corrupting the Overview only if the read paths are made year-safe first.
- Eight KPI SELECT statements are not year-safe today (five hardcode `2026`, three carry no year predicate at all). None crash if pre-2026 rows exist - they silently over-count or return the wrong-year figure. This is the one gate that determines whether W1 loads history into the same tables or into a `_history` twin.
- FY2024 + FY2025 + FY2026 P9 + both FY2027 scenario workbooks all share the FY2026 P&L layout so cleanly that the existing loader parses P9 without a single unrecognized code. One label-driven shape adaptation catches FY2024's `PFS - CINN` row shift; nothing else needs rewriting for W1's shape work. FY2023 stays parked per R-10.
- Kevin's seven stated facts are 4 confirmed / 1 differs / 2 partially confirmed. The one that differs: only two of the four PDC accounts (`TBJ - FL`, `TBR - FL`) carry `sc_revenue_live = true` today. `CIN - AZ` and `TXR - AZ` have full SC data but the flag is still false.
- Recommended W1 shape: multi-year fiscal calendar as a small `fiscal_periods` table (or a generalized `periods.js`), a sibling `load_pnl_history.mjs` that shares reconciliation with `derive_pnl_actuals.mjs`, and read-path fixes to the eight unsafe queries before any historical row is loaded. Rough hours in §13. The FY2027 scenario architecture (PR-5/PR-6) is a W3 build; nothing found in this recon changes its design.
- One P0-class read-path issue was found outside the scope of this brief: the `sc_daily_revenue` view's `COALESCE(pr_act.price, pr_proj.price, 0)` will silently return **latest** projected prices for pre-2026 service dates that lack an in-period price row. Not a W0 blocker; noted in §8.

---

## 1. Kevin's stated facts - verification table

| # | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|
| 1 | SC is live for 2026 on four accounts only: TBJ - FL, TBR - FL, CIN - AZ, TXR - AZ | **DIFFERS** | [live: `kpi_account_flags`, 11 rows] | `sc_revenue_live=true` on only 2 accounts today: TBJ - FL and TBR - FL. CIN - AZ and TXR - AZ carry full projections+actuals+phase data but the flag is `false`. Kevin's intent may be operational-live rather than dashboard-flag-live; verify which meaning is authoritative. |
| 2 | The 2026 projections loaded in PG are accurate | **CONFIRMED (with caveats)** | [doc: `docs/audits/SC_PROJECTION_CALIBRATION_2026-08-20.md`], [live: `sc_daily_projections` per account, 2025-12-29..2026-12-29 range] | CIN - AZ: overall mean delta +0.15 meals/day, target-state. TXR - AZ: mean +2.86 with bimodal distribution and 1,095 unpaired actuals. Kevin's own ruling: invoicing bills off actuals, so miscalibration is untidy rather than broken. |
| 3 | Another session is loading 2023-2025 SC-style projections + actuals into PG (analysis only, never intranet display) | **CANNOT VERIFY (no data yet)** | [live: `sc_daily_projections WHERE service_date < '2026-01-01'`, 150 rows total across 4 accounts, all inside the FY2026 P1W1 opening week 2025-12-29..2026-01-01] | Zero rows with `service_date < 2025-12-29`. Zero actuals with `service_date < 2026-01-03`. W2 has nothing to reconcile yet. |
| 4 | KPI board is still being built; FY2026 budgets are loaded in PG | **CONFIRMED** | [live: `kpi_budgets` 4,511 rows all `fiscal_year=2026`; 11 accounts x 34 lines x 13 periods, zero gaps] | Every account/line has all 13 periods. `verify_budget_seed_vs_xlsx.mjs` and PR #667 established the load. |
| 5 | KPI P&L actuals for P1-P9 FY2026 are accurate within 0.5% of finance for every account except TXR - TX - V (which is excluded until year end) | **CONFIRMED for P1-P8 · DIFFERS for P9** | [live: `pnl_actuals` P1-P8 = 2,815 rows, P9 = 0 rows], [code: `scripts/derive_pnl_actuals.mjs:456-590` reconciliation], [dry-run: 11/11 accounts MATCH on FY2026 P9 workbook, delta 0.00, drift rows 0] | P9 is not in PG yet. Dry-run on the P9 workbook proves the loader parses cleanly and reconciles to the cent - Kevin's claim will be met by the existing loader with `--periods 1-9`. TXR - TX - V is present in `pnl_actuals` P1-P8 (32 rows) - "excluded until year end" refers to the dashboard build, not the load itself. |
| 6 | Full-year budget-vs-actual workbooks for FY2023, FY2024, FY2025 exist and are NOT in PG | **CONFIRMED** | [live: only `fiscal_year=2026` rows in `kpi_budgets`, `pnl_actuals`, `kpi_period_status`, `labor_actuals`], [probe: `_probe_fin2027_workbook_shape.mjs` confirms FY2024 + FY2025 workbook shape] | FY2023 parked per R-10. |
| 7 | Site history, contracts, and account details live in OPD docs and `docs/pricing-summit/` digests; some may need updating | **PARTIALLY CONFIRMED** | [doc: 12 `docs/pricing-summit/CONTRACT_DIGEST_*.md` files, last updated 2026-07-14], [doc: `LEDGER.md`, TBR-FL escalation withdrawal 2026-08-11] | Site history lives in `LEDGER.md` + per-account contract digests, not in OPD `content/documents/*.mdx`. OPD content is operational documents (SOPs, forms, policies); it does not carry contract or billing knowledge. See §9. |

---

## 2. Findings ledger

| ID | Sev | Finding | Evidence | Affects | Suggested owner |
|---|---|---|---|---|---|
| F-1 | **P0** | Five KPI/labor SELECTs hardcode `fiscal_year = 2026`; three labor SELECTs carry no year predicate. Historical rows in `kpi_budgets`, `sc_labor_budgets`, or `labor_actuals` will either be silently ignored (hardcoded case) or silently merged across years (no-predicate case). | [code: `src/app/api/kpi/labor/route.js:1186`, `:1187` (no-year sc_labor_budgets), `:319-321`, `:385`], [code: `src/lib/labor/dailyRangeBody.js:119`, `src/lib/labor/loaders.js:118`, `src/lib/labor/salaryBoard.js:58`] | W1, PR-1 | Fix in one focused PR before any FY2024-2025 row lands. See §7 for the full query table and §13 for hours. |
| F-2 | P1 | Three `FISCAL_YEAR = 2026` constants inside KPI resolvers + one in purchasing route. Loaders that already take `fiscalYear` as a parameter (pnl-loader, purchasing loaders) are pinned by their callers. | [code: `src/lib/kpi/overview/resolver.js:120`, `src/lib/kpi/shared/periodBasis.js:63`, `src/app/api/kpi/purchasing/route.js:476`, `src/lib/labor/labor-batr.js:33`, `src/lib/labor/salaryBoard.js:45`] | W1 | Ships with F-1 fix. |
| F-3 | P1 | `sc_daily_revenue` view uses `COALESCE(pr_act.price, pr_proj.price, 0)` - a historical service date with no in-year `sc_service_prices` row falls to whatever the newest projected price is (currently effective 2026-01-01..2026-08-24). Silent forward-price contamination on pre-2026 SC rows. | [live: `pg_get_viewdef('sc_daily_revenue')`], [doc: `docs/SC_MONEY_MODEL.md`] | W2 | If W2 loads pre-2026 SC data, seed historical `sc_service_prices` rows in the same session, or lift `sc_daily_revenue` to reject dates outside the price coverage window (return NULL not fallback). |
| F-4 | P1 | 1,206 `labor_actuals` rows have `period_no IS NULL` (~10% of the table). These do not participate in the Overview board today. Historical years multiply this class. | [live: `SELECT count(*) FROM labor_actuals WHERE period_no IS NULL`] | W1, W4 | Already acknowledged in KPI arc; note that the multi-year fix must also assign `fiscal_year` on these rows. |
| F-5 | P1 | `sc_service_prices` has zero rows with `effective_date < 2026-01-01`. Any pre-2026 service actuals loaded into `sc_daily_actuals` will hit the F-3 fallback and be priced at 2026 rates. | [live: `SELECT min(effective_date), max(effective_date), count(*) FROM sc_service_prices`] | W2 | Historical price seed required before pre-2026 SC actuals. |
| F-6 | P2 | REDS (=Goodyear AZ = CIN - AZ) / CINN (=Cincinnati OH = CIN - OH) tab-name collision is documented as a Rippling department issue in Playbook §D32 but NOT in §3.6 (naming trap) or §3.7 (same-code collisions). Historical loaders keyed on tab name alone will swap them. | [doc: `docs/KPI_DASHBOARD_PLAYBOOK.md` §3.6, §3.7, §D32], [probe: FY2024 tabs `PFS - REDS` = Goodyear, `PFS - CINN` = Cincinnati] | W1 | Add the tab-name trap to Playbook §3.6 in the W1 doc-fix pass. |
| F-7 | P2 | `SC_KPI_PUSH_CONTRACT.md` opens with "the dashboard itself is a separate future project" (line 3). The Overview board is live in `src/app/api/kpi/overview/route.js` and resolvers ship the R-20 revenue rule today. | [code: `src/app/api/kpi/overview/route.js`, `src/lib/kpi/overview/resolver.js`], [doc: `docs/SC_KPI_PUSH_CONTRACT.md:3`] | W3+ | Update or archive the contract doc; the mechanic exists and is not a future project. |
| F-8 | P2 | `BACKDATE_FLOOR = "2024-01-01"` and `FEE_BACKDATE_FLOOR` are enforced only in `src/app/api/service-calendar/route.js` (~lines 2200-2620). No table-level `CHECK` constraint blocks pre-2024 dates on `sc_service_prices` or `sc_fee_schedule`. Scripts (not the API) can insert 2023 rows. | [code: `src/app/api/service-calendar/route.js` grep BACKDATE_FLOOR], [live: `information_schema.check_constraints` scan] | W2 | If FY2023 is ever revived, add the floor as a CHECK, not an application constant. |
| F-9 | P2 | `TBR (PFS)` tab in FY2025 workbook has row-4 P1 date = `2025-01-01`, whereas the other 10 portfolio tabs use `2024-12-30`. Value: same period boundaries; label: different cell content. | [probe: `_probe_fin2027_workbook_shape.mjs` FY2025 output] | W1 | Label-driven loader (F-10) side-steps this. Log as workbook oddity, do not fix in FY2025 file. |
| F-10 | P2 | `PFS - CINN` in FY2024 has 12/16 REV_COGS fixed-row hits (misses at r36, r41, r47, r54 - all "Total X" rows). Consistent with the Chat-Claude pre-read: missing `3100.2` shifts rows 36+ up by one, turning what should be leaf-code rows into Total-row aggregators. | [probe: FY2024 shape output for `PFS - CINN`] | W1 | Confirms the sibling loader (§6, §13) must be label-driven, not fixed-row-driven, for FY2024-FY2025. FY2026 + FY2027 + FY2026 P9 hold at 16/16. |
| F-11 | P3 | `gl_codes` carries 20 codes not in `kpi_lines` (all `is_historical=true`). `kpi_lines` carries 2 codes not in `gl_codes` (2600, 3500.1). | [live: set diff over `gl_codes` vs `kpi_lines`], [doc: `docs/KPI_DASHBOARD_PLAYBOOK.md` §3.1] | W1 | Historical retirement is already accounted for by `is_historical=true`. FY2024/FY2025 workbook portfolio tabs carry zero unknown codes so the loader's loud-stop never fires; retired codes only appear in out-of-scope tabs (`1731`, `CHI`, `CORP`). |
| F-12 | P3 | `sc_qbo_account_map.qbo_mode = 'test'` on all 4 mapped accounts (CIN - AZ, TBJ - FL, TBR - FL, TXR - AZ). No production QBO integration is live. | [live: `sc_qbo_account_map`] | W4 (QBO as second source) | Josh's QBO API pointer is a project, not a switch. |
| F-13 | P3 | Contract paperwork gaps: TBJ - NY has no executed 2025+ SOW on file (rate operationally verified only); TBR - FL 2025+2026 SOWs missing (variable SF installment amount cannot be reconciled); CIN - AZ, TXR - AZ 2026 SOWs missing (rates operationalized). | [doc: `docs/pricing-summit/CONTRACT_DIGEST_TBJ-NY.md`, `CONTRACT_DIGEST_TBR-FL.md`, `CONTRACT_DIGEST_CIN-AZ.md`, `CONTRACT_DIGEST_TXR-AZ.md`, `LEDGER.md` §Q.19 + §M.2] | W4 | Pre-existing; carries into FIN-2027 as certification-layer risk. |

---

## 3. Fiscal calendar

**Where defined.** Single hardcoded FY2026: start `2025-12-29`, 13 x 28-day periods, end `2026-12-27`. Formula lives in one client-side helper; every KPI reader either reuses it or pins to `2026` directly.

Files that hardcode FY2026 bounds:

- `src/app/kpi/labor/lib/periods.js:19-20` - `FY_START_ISO = "2025-12-29"`, `FY_END_ISO = "2026-12-27"`
- `src/app/kpi/labor/lib/periods.js:22` - `DAYS_PER_PERIOD = 28`
- `src/app/kpi/labor/lib/accounts.js:66` - `FY_START = "2025-12-29"` (re-export)
- `src/lib/kpi/overview/resolver.js:120` - `const FISCAL_YEAR = 2026;`
- `src/lib/kpi/shared/periodBasis.js:63` - `const FISCAL_YEAR = 2026;`
- `src/app/api/kpi/purchasing/route.js:476` - `const fyForRange = 2026;`
- `src/lib/kpi/overview/pnl-loader.js:57, :133, :182, :233` - default parameter `fiscalYear = 2026`
- `src/lib/labor/labor-batr.js:33` - `const FISCAL_YEAR = 2026;`
- `src/lib/labor/salaryBoard.js:45` - `const FY2026 = 2026;`
- `src/lib/labor/homestandResolver.js:225` - default parameter `fiscalYear = 2026`
- `src/app/api/kpi/labor/route.js:868, :1186, :1217` - hardcoded `fiscal_year: 2026` in query filters and response construction
- `src/app/kpi/labor/page.js:449, :544` - client-side fallback `?? 2026`
- `src/app/kpi/purchasing/page.js:759` - client-side response builder `fiscal_year: 2026`

**Migration seed.** `docs/migrations/pnl-1-actuals-and-status.sql:238-273` seeds only FY2026 P1..P13 rows into `kpi_period_status`.

**Live probe.** `SELECT DISTINCT fiscal_year FROM ...` on `pnl_actuals`, `kpi_budgets`, `labor_actuals`, `kpi_period_status` returns only `2026`. `kpi_period_status` FY2026 P1..P8 have `closed_at` and `verified_at = 2026-08-20`; P9..P13 have both NULL.

**Answers.**
- No period definitions for FY2023/FY2024/FY2025 exist anywhere in repo or DB.
- No 53-week logic in code. Finance-workbook calendar convention was verified from probe against the five workbooks: FY2024 P1 start `2024-01-01`; FY2025 P1 start `2024-12-30`; FY2026 P1 start `2025-12-29`; FY2027 P1 start `2026-12-28` (both scenario files agree). All 13 x 28 = 364 days. Chat-Claude pre-read of §5.9 table CONFIRMED.
- What breaks if `fiscal_year <> 2026`? Nothing crashes; the hardcoded queries silently skip the row, the FYTD helpers report the 2026 window regardless, and the labor staleness banner reports global max(`derived_at`). See §7 for the full query table and F-1 in §2.
- **Minimum durable multi-year change** (describe, size in §13): a `fiscal_periods(fiscal_year, period_no, start_date, end_date)` table plus a generalized `periodOf(fiscalYear, date)` in `periods.js`, plus removing the ~15 hardcoded `2026` references. The refactor is shallow (constants + defaults, not buried logic) but touches many files.

---

## 4. Accounts + chart of accounts

**Canonical account_key list + regex.** Enforced via CHECK on `kpi_line_activation.account_key` [code: `docs/migrations/kpi-1-spine.sql:279`]: `^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$`. Live probe returns 12 accounts: CIN - AZ, CIN - KY, CIN - OH, STL - FL, STL - MO, TBJ - FL, TBJ - NY, TBR - FL, TXR - AZ, TXR - TX - H, TXR - TX - V, CORP.

**Tab-name -> account_key map.** Two independent mappings live in the codebase:

1. `accounts.pnl_tab_name` column [live table, seeded at `docs/migrations/kpi-1-spine.sql:196-206`] - the DB-side authority.
2. `TAB_TO_ACCOUNT` object [code: `scripts/derive_pnl_actuals.mjs:91-103`] - the FY2026 loader's own map.

Both agree for FY2026. For FY2024/FY2025 the tab names differ (see §11) and the loader map does not cover them; a per-year map is required in W1.

**Revenue models.** `kpi_account_flags` [live, 11 rows]:
- `sc_driven` (6): CIN - AZ, CIN - KY, TBJ - FL, TBJ - NY, TBR - FL, TXR - AZ. Actuals fluctuate with SC meal counts.
- `management_fee` (4): CIN - OH, STL - FL, STL - MO, TXR - TX - H. Contracted flat fee prorated per contract installment schedule.
- `sales_based` (1): TXR - TX - V. Envelope-driven (`labor_ratio = 0.1923`).

Field values seeded 2026-09-03 via `docs/migrations/pnl-2-revenue-model.sql:1-66`.

**Account start/end dates.** No `contract_start`, `first_service_date`, or `retired_at` column on `accounts` [live schema check]. `pnl_tab_name = NULL` marks CORP as the deactivation channel. `kpi_line_activation.fiscal_year` is the only year-scoped lever (per-account per-line active flag per fiscal year); currently populated only for `fiscal_year=2026`. Contract terms live in `docs/pricing-summit/CONTRACT_DIGEST_*.md` per account.

**Is the 34-line chart FY2026-specific?** Yes, in the sense that `kpi_line_activation` has FY2026 rows only (374 rows: 11 accounts x 34 lines, 350 active + 24 inactive). The 34 line codes themselves are stable across the four supplied workbooks (FY2024 forward). FY2023 (parked) carries three retired codes: `3200.3`, `5017.1`, `5017.4` (per §5.9 pre-read; not verified this session).

**`gl_codes` vs `kpi_lines` set diff** [live]:
- In `gl_codes` but not `kpi_lines`: 20 codes (`5004.1, 5004.2, 5004.4, 5004.6, 5004.7, 5006.2, 5006.4, 5011.1, 5012.4, 5012.6, 5013.3, 5013.5, 5016.1, 5016.2, 5016.4, 5016.5, 5017.1, 5017.2, 5017.4, 5017.6`). All `is_historical = true`.
- In `kpi_lines` but not `gl_codes`: `2600`, `3500.1`.

**CORP.** `TAB_TO_ACCOUNT` [code: `scripts/derive_pnl_actuals.mjs:104`] pushes `CORP` into `IGNORE_TABS`. `kpi_line_activation` seed excludes CORP via `WHERE a.team_key <> 'CORP'` [code: `docs/migrations/kpi-1-spine.sql:305`]. No CORP rows exist in `pnl_actuals` or `kpi_budgets`.

---

## 5. P&L / KPI data layer - live state

Grain and provenance table (all live probes; no dollars):

| Table | Grain (PK / natural key) | Populate source | Cadence | Verification |
|---|---|---|---|---|
| `kpi_budgets` | `(account_key, line_code, fiscal_year, period_no)` | `scripts/load_kpi_budgets_2026.mjs` from Kevin's seed JSON | one-shot FY2026 load; `loaded_at` timestamp | `scripts/verify_budget_seed_vs_xlsx.mjs`, 11/11 TIE (PR #667) |
| `pnl_actuals` | `(account_key, fiscal_year, period_no, line_code)` | `scripts/derive_pnl_actuals.mjs` from finance workbook | per-period after close; `verified_at` on `kpi_period_status` | reconciliation table in the loader; recon PASS 11/11 accounts P8 (PR #902) and P9 dry-run |
| `kpi_period_status` | `(fiscal_year, period_no)` | seed migration + loader UPDATE | per-period on load | `closed_at` from fiscal-calendar math; `verified_at` from loader |
| `sc_labor_budgets` | `(account_key, period, effective_from)` with `superseded_at` supersede pattern | admin write (Kevin) | per-write; 7 rows per each of 4 MLB accounts (CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V) | `reason` + `changed_by` + `changed_at` self-audit |
| `labor_actuals` | `(account_key, worker_id, week_label, line_code)` | `derive_labor_actuals_*.mjs` from Rippling + `sc_day_metadata` | nightly | period walkthrough probe; recon vs Rippling report |
| `labor_actuals_latest` | same | materialized from `labor_actuals` | on sync | same |
| `purchasing_actuals` | `(source, source_bill_id, source_line_id)` | bill.com API + Rippling card feed | continuous | `_probe_purchasing_actuals_*.mjs` |
| `v_purchasing_by_site_period` | view over `purchasing_actuals` | on read | real-time | underlying probes |
| `inventory_adjustments` | `(account_key, fiscal_year, period_no)` | admin write | per-period | manual review |

**Coverage snapshot** (dates and counts only):

- `kpi_budgets`: 4,511 rows, all `fiscal_year = 2026`; 11 accounts x 32-34 lines x 13 periods; zero period gaps.
- `pnl_actuals`: 2,815 rows, all `fiscal_year = 2026`, `period_no IN (1..8)`; 11 accounts x ~32 lines x 8 periods. `budget` column populated on 2,815 / 2,815. `max(loaded_at)` = 2026-08-31. **P9 row count = 0** (dry-run below shows 3,167 rows would insert on a full-year P1..P9 load, ~352 of which are net-new P9 rows).
- `kpi_period_status`: 13 rows FY2026. P1..P8 verified 2026-08-20; P9..P13 have `verified_at IS NULL, closed_at IS NULL`.
- `sc_labor_budgets`: 28 rows across 4 accounts.
- `labor_actuals`: 2025-12-29..2026-09-20; 9 accounts (excludes TXR - TX - H, TXR - TX - V); 1,206 rows have `period_no IS NULL` (F-4).
- `purchasing_actuals`: 2014-11-04..2026-09-16; 11 client accounts + 1 NULL account_key.

**Absence rule.** [code: `scripts/derive_pnl_actuals.mjs:18-21`] an absent `(account_key, fiscal_year, period_no, line_code)` row means NOT REPORTED, never zero. Enforced downstream: `src/lib/kpi/overview/pnl-loader.js:172-181` returns a nested Map with only loaded rows; `src/lib/kpi/overview/resolver.js:145-172` propagates the `reported: true|false` flag onto statement rows. No violations found in the three read paths; UI rendering not audited this session.

**Kevin's 0.5% claim.** CONFIRMED for P1..P8 (see §1 row 5). P9 is not in PG (0 rows). The P9 workbook dry-run reconciled 11/11 accounts, delta 0.00, drift rows 0 - the load simply has not been run yet. Recommended: rerun `derive_pnl_actuals.mjs --file <P9> --periods 1-9` when Kevin greenlights.

**TXR - TX - V exclusion.** Present in `pnl_actuals` P1..P8 (32 rows). Absent from `labor_actuals`. `kpi_account_flags.revenue_model = 'sales_based'`. Including it in labor later requires (a) Rippling scope expansion or manual entry, (b) resolving the pay-segment ambiguity between TXR-HOME and TXR-VISITOR departments in Rippling (per BUSINESS_NOTES.md).

---

## 6. Loaders + loader discipline

**Hardcoded FY2026 assumptions in `scripts/derive_pnl_actuals.mjs`** (each needs to become a parameter or a per-year config for W1):

- Line 87 - `const FISCAL_YEAR = 2026;`
- Lines 91-103 - `TAB_TO_ACCOUNT` (FY2026 tab names)
- Line 111 - `REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54]`
- Line 113 - `SGA_ROW_RANGE = { first: 60, last: 97 }`
- Lines 119-122 - column arithmetic `periodBudgetCol / periodActualCol / ytdBudgetCol / ytdActualCol`
- Lines 85-86 - `DEFAULT_VERIFIED_AT`, `DEFAULT_VERIFIED_BY` (period-specific)
- Lines 632-656 - `kpi_period_status` UPDATE assumes rows for the year exist (seed migration only seeds FY2026)
- Lines 80-84 - `DEFAULT_WORKBOOK_PATH` (FY2026 naming)

**Retired-line behavior.** Lines 333-336 (REV/COGS) and 373-376 (SG&A) collect unrecognized codes into `unrecognizedCodes`; lines 403-410 loud-stop with `exit 2` before any DB write. A historical `3200.3` or `5017.1` code in an FY2023 workbook (parked) would abort the load. Portfolio-tab codes in FY2024/FY2025/FY2026 P9/FY2027 all live in `kpi_lines` today (verified by shape probe - see §11).

**Idempotency.** Upsert on `onConflict: "account_key,fiscal_year,period_no,line_code"` [code: `scripts/derive_pnl_actuals.mjs:605-610`]. `kpi_period_status` UPDATE targets only `verified_at / verified_by / source_ref / updated_at`; `closed_at` is never touched [line 655 comment]. Re-runs of a corrected workbook are safe.

**Zero-dollars-in-repo discipline.** [code: header comment lines 12-15] Workbooks live in `~/Downloads/`; seed JSONs live outside the repo; probes print counts + PASS/FAIL only. `_probe_fin2027_workbook_shape.mjs` and `_probe_fin2027_scenario_diff.mjs` (this session) print labels + dates + counts + PASS/FAIL only - no amounts. Sentinel values in code are outside-data reference figures, not repo constants.

**Recommendation.** Write `scripts/load_pnl_history.mjs` as a sibling to `derive_pnl_actuals.mjs`, sharing a `scripts/lib/reconcile_pnl.mjs` module extracted from lines 456-590 of the current loader. Rationale: the FY2026 loader is load-bearing for the live Overview (period-status verified flags gate the "locked/verified" surface); parametrizing in-place risks a live-Overview breakage. A sibling loader is testable in isolation. Rough hours: **8-16h** including tests and the shared reconciliation module. Alternative parametrize-in-place: 4-8h if the FY2024/2025 tab structure holds (which the shape probe confirms, with the one CINN row-shift exception).

---

## 7. KPI read paths - fiscal_year safety

**Verdict.** FY2024/FY2025 rows CANNOT be safely added to the existing tables without a query-level fix pass first. Eight queries need attention (5 hardcoded to `2026`; 3 with no year predicate). Recommendation: **Path (a) - add `fiscal_year` predicates before landing history.** Same table, one loader, one PK - the schema was built for multi-year; only the readers assume single-year. Splitting to `_history` tables is heavier and does not solve the labor/purchasing readers (which would still SUM the wrong year on the primary tables in normal use).

**Query table** (one row per SELECT against a year-keyed KPI table):

| file:line | table | fiscal_year predicate? | date predicate implying FY26? | notes |
|---|---|---|---|---|
| `src/lib/kpi/overview/pnl-loader.js:61` | `kpi_period_status` | YES (param `fiscalYear`) | n/a | SAFE - loader is parameterized |
| `src/lib/kpi/overview/pnl-loader.js:142` | `inventory_adjustments` | YES (param) | in(period_no) | SAFE |
| `src/lib/kpi/overview/pnl-loader.js:193` | `pnl_actuals` | YES (param) | in(period_no) | SAFE |
| `src/lib/kpi/overview/pnl-loader.js:243` | `kpi_budgets` | YES (param) | in(period_no) | SAFE |
| `src/lib/purchasing/loaders.js:371` | `kpi_budgets` | YES (param) | in(period_no) | SAFE |
| `src/app/api/kpi/labor/route.js:1186` | `kpi_budgets` | **HARDCODED 2026** | n/a | **P0** F-1 |
| `src/app/api/kpi/labor/route.js:1187` | `sc_labor_budgets` | **NO** | n/a | **P0** F-1 - merges across years |
| `src/lib/labor/dailyRangeBody.js:119` | `kpi_budgets` | **HARDCODED 2026** | n/a | **P0** F-1 |
| `src/lib/labor/loaders.js:118` | `kpi_budgets` | **HARDCODED 2026** | n/a | **P0** F-1 |
| `src/lib/labor/salaryBoard.js:58` | `kpi_budgets` | **HARDCODED 2026** | n/a | **P0** F-1 |
| `src/app/api/kpi/labor/route.js:319` | `labor_actuals` | NO | NO | **P1** F-1 (staleness banner) |
| `src/app/api/kpi/labor/route.js:321` | `labor_actuals_daily` | NO | NO | **P1** F-1 (staleness banner) |
| `src/app/api/kpi/labor/route.js:385` | `labor_actuals` | NO | NO | **P1** F-1 (daily-floor) |

Purchasing tables (`purchasing_actuals`, `v_purchasing_by_site_week`) have no `fiscal_year` column and are keyed on `txn_date`; year-isolation is implicit via date-range filter. Year-safe by structure.

**FYTD.** `src/lib/kpi/overview/resolver.js:339` and `src/app/kpi/labor/lib/periods.js` compute FYTD from calendar dates; year is not a standalone constant in these helpers. Risk lives in the hardcoded queries above.

**Sous AI tools.** `src/lib/sousai/**` tools (`sc_portfolio_window`, `sc_account_window`) read `sc_daily_revenue` only, filtered by date range; no KPI table reads. Year-safe by structure.

**Operator Excel export.** `GET /api/service-calendar/export` does not read `pnl_actuals`, `kpi_budgets`, or labor tables. Year param is used for date-range scoping only. Year-safe.

**Recommended fix cadence for W1.** One focused PR that parameterizes the 5 hardcoded `2026` labor queries + adds `.eq("fiscal_year", param)` to the 3 no-predicate queries. Same pattern the pnl-loader/purchasing loaders already use. Then W1 loads history into the same tables.

---

## 8. Service Calendar - data, money model, coverage

**Three billing modes** [doc: `docs/SC_MONEY_MODEL.md`]:

1. **Per-meal + SF%** (SF component discounts the sticker rate). Accounts: CIN - AZ (30% SF), TXR - AZ (20% deposit), TBR - FL MiLB (25% SF on buffet only). Revenue = actual_count x post-SF invoice rate + SF component tracked separately in `sc_fee_schedule` and P&L line 2300.
2. **Per-meal + independent SF** (flat annual SF, per-meal at sticker). Account: TBJ - FL. Revenue = actual_count x sticker + SF as its own installment schedule (amounts in `sc_fee_schedule` / contract; not restated here).
3. **Flat fee** (fee IS the money; per-meal counts are operational only). Accounts: CIN - OH, STL - MO, STL - FL, TXR - TX - H (with TXR - TX - V bundled). Revenue = contracted annual flat fee, prorated per contract; per-meal price in `sc_service_prices` is zero by design.

Pure per-meal, no SF: CIN - KY, TBJ - NY (both MiLB, weekly per-meal billing).

**Live accounts in 2026** [live: `kpi_account_flags.sc_revenue_live`]:
- `true`: TBJ - FL, TBR - FL
- `false`: all other 9 accounts including CIN - AZ, TXR - AZ (which have full data)

Kevin's list (TBJ - FL, TBR - FL, CIN - AZ, TXR - AZ) DIFFERS - the flag is set on only 2 of the 4. Two possible interpretations: (a) the flag has fallen behind reality and needs Kevin to flip CIN - AZ and TXR - AZ to `true`; (b) "live" in Kevin's phrasing means operational-live (accepting service+billing) rather than dashboard-live (KPI Overview reads revenue from SC). Open question for Kevin (§12).

**2026 projections.** Loaded by `scripts/_seed_sc_from_xlsx.mjs` [code, plus `scripts/billing/*` pinned workbook hashes]. Calibration audit [doc: `docs/audits/SC_PROJECTION_CALIBRATION_2026-08-20.md`]: CIN - AZ mean delta +0.15 (target state); TXR - AZ mean +2.86 with bimodal per-service distribution and 1,095 unpaired actuals. Kevin's ruling: invoicing bills off actuals so miscalibration is untidy, not broken.

**Pre-2026 SC data present.** 150 projection rows with `service_date < 2026-01-01`, all inside the FY2026 P1W1 opening week `2025-12-29..2026-01-01`. Distributed across 4 accounts (CIN - AZ 39, STL - FL 21, TBJ - FL 42, TBR - FL 48). Zero actuals with `service_date < 2026-01-03`. **W2 has no pre-2026 rows to reconcile yet.**

**`BACKDATE_FLOOR = "2024-01-01"`** [code: `src/app/api/service-calendar/route.js` around lines 2200-2620]. Gates: `sc-upsert-prices`, `sc-upsert-fee-schedule`, `sc-day-note-archive`. API-only. No table-level CHECK constraint enforces the floor - see F-8. A script-authored 2023 row would land at the schema layer but hit F-3 (price fallback) or F-5 (no prices exist in 2023).

**SC revenue -> KPI Overview.** The Overview reads from `pnl_actuals` (finance workbook, authoritative for revenue lines) for statement rows and from `sc_daily_revenue` / `sc_month_summary` only where the KPI push contract calls for it. The `SC_KPI_PUSH_CONTRACT.md` header ("dashboard is a separate future project") is doc drift - see F-7.

**Effective-dated pricing for historical years.** `sc_daily_revenue` view definition [live: `pg_get_viewdef`] uses `COALESCE(pr_act.price, pr_proj.price, 0)` where `pr_proj` is a LATERAL join `WHERE effective_date <= service_date ORDER BY effective_date DESC LIMIT 1`. **F-3**: a pre-2026 service date with no in-year price row will read the newest projected price, not NULL. Silent forward-price contamination.

---

## 9. Contracts, OPD, business knowledge

12 per-account contract digests live in `docs/pricing-summit/CONTRACT_DIGEST_*.md`, all last updated 2026-07-14. Summary (contract type + revenue model + 2027 relevance; no dollar amounts):

| account_key | contract type | revenue model | 2027 relevance | digest gap |
|---|---|---|---|---|
| CIN - AZ | Base + 2 renewal terms (Reds-held, notice by Nov 1 2026 for 2027 extension) | per-meal + 30% SF | RENEWAL DECISION 2026-11-01 | 2026 SOW missing (rates operationalized via Price Review v3) |
| CIN - KY | Single-year 2026 (Apr 21 2026 exec) | per-meal, no SF | 2027 OPEN - must negotiate | invoice samples missing |
| CIN - OH | 2025-26 MLB agreement + 2027 option (Reds-held, notice by Oct 1 2026) | flat-fee MLB homestand | RENEWAL DECISION 2026-10-01 | invoice samples missing |
| STL - FL | 2025-27 base + Oct 2025 amendment (Jupiter) | flat-fee (with 2027 work-stoppage contingency) | 2027 LOCKED · work-stoppage contingency drives Nov 1 2026 / Apr 1 2027 payments | complex 2027 contingency schedule |
| STL - MO | 2025-27 base (Nov 2024 exec) | flat-fee MLB | 2027 LOCKED, hard term end 2027-12-31 | invoice samples missing |
| TBJ - FL | 2023 base + auto-renew (1st renewal year now; Club opt-out notice Dec 17 2026 for 2027) | per-meal + independent SF (annual flat) | 2027 LOCKED via auto-renew unless Club opts out | SF installment cadence sourced from OneSheeter, not contract |
| TBJ - NY | 2018 Rogers MSA + no 2025+ SOW on file | per-meal, no SF (rate assumption-only) | 2027 CRITICAL PAPERWORK GAP | no executed SOW on file (F-13) |
| TBR - FL | 2024 base + separate MLB/MiLB SOWs (notice by Oct 1 2026 for 2027 MLB, MiLB extension too) | per-meal + 25% MiLB-buffet SF | RENEWAL DECISIONS 2026-10-01 · escalation basis unverified pending Joe/Josh direct read (2026-08-11 withdrawal) | 2025 + 2026 SOWs missing (F-13); BGC second-client 2026-27 not on file |
| TXR - AZ | 2025-27 base + SOW #1 (2026 SOW missing) | per-meal + 20% SF (deposit model) | 2027 LOCKED under initial term | 2026 SOW missing (rates operationalized) |
| TXR - TX - H | Single-year 2026 (Jan 21 2026 exec) | flat-fee MLB homestand | 2027 OPEN - must negotiate | §2(d) kitchen-setup budget clause missing |
| TXR - TX - V | Bundled with TXR - TX - H under a single annual fee | flat-fee bundled + direct-sales revenue (revenue-flex labor 19.23%) | 2027 OPEN - must negotiate; labor model requires Rippling pay-segment integration | no standalone SOW |
| CORP | n/a - excluded from FY2027 scope (R-4) | n/a | excluded | n/a |

Optional 12th row - BGC (Boys & Girls Club of Charlotte County, second client on TBR - FL commissary): 2025-26 school-year contract runs Aug 19 2025 - May 21 2026; 2026-27 renewal NOT on file. Recommend deferral from FIN-2027 core unless renewed with material change.

**Document authorities:**
- Contract terms → executed contracts (block-quoted in each digest); ABR OneSheeter and `ACCOUNT_SERVICES_BRIEF.md` carry older framing.
- Per-service prices → Price Review v3 (2026-06-16, Joe attested) + `docs/SC_MONEY_MODEL.md` (canonical since 2026-07-09); `sc_service_prices` in PG must match.
- Fees → executed contracts + `SC_MONEY_MODEL.md` §K.
- Chart of accounts → `kpi_lines` in PG + `KPI_DASHBOARD_PLAYBOOK.md` §3.2; `PL_2026_APPENDIX.md` is demoted (partial).
- Revenue model per account → `SC_MONEY_MODEL.md` post-2026-07-09 + `BUSINESS_NOTES.md`; older `ACCOUNT_SERVICES_BRIEF.md` sections still carry pre-alignment terminology (P2 doc-drift).
- Labor budget authority → 2026 P&L workbook baseline + `sc_labor_budgets` supersede rows (per `KPI_DASHBOARD_PLAYBOOK.md` §4.5).

**OPD / Playbook contribution to FIN-2027.** OPD is the operational-document catalog (SOPs, forms, policies) shipped under `content/documents/*.mdx` + PG `documents` / `document_relationships` tables. It does NOT carry contract, billing, or per-account financial knowledge. Site history for FIN-2027 lives in `docs/pricing-summit/LEDGER.md` (audit-trail + decision-journal) + per-account contract digests. OPD's role is referential linking (a REF-129 doc can point to the TBR - FL withdrawal) but the source-of-truth is pricing-summit + LEDGER.

---

## 10. Tooling for analysis

- **Sanctioned read-only SQL from CC.** `node --env-file=.env.local scripts/_probe_*.mjs` with a service-role Supabase client. Confirmed with `scripts/_probe_fin2027_db_connect.mjs` (harmless `SELECT count(*) FROM kpi_lines` returned 34) - PASS.
- **Supabase MCP.** Available and used in this session (all §5.3 + §5.6 live probes went through MCP). Large-result spill pattern (`repeat('x', 500000) AS pad` to force `tool_results` to a file) available if needed but not required this session.
- **Reusable affordances:**
  - `/api/service-calendar/export` operator Excel export (sheets K1-K3, L1-L5, BY PHASE / BY PERIOD).
  - Sous AI `sc_portfolio_window` / `sc_account_window` tools (SC revenue rollups over date ranges).
  - KPI Overview resolver as a library function (`src/lib/kpi/overview/resolver.js`) - can be called from a probe with a fabricated request.
  - Existing `_probe_pnl_actuals_sentinels.mjs`, `_probe_labor_walkthrough_pra.mjs`, `_probe_purchasing_actuals_*.mjs`.
- **Recommended location for FIN-2027 analysis.** `scripts/fin2027/` folder for W3/W4 probes: read-only, no dollar literals, output workbooks to `~/Downloads/fin2027_*.xlsx`. Do not commit workbooks or seed JSONs.

---

## 11. Workbook shape review (§5.9 - each Chat-Claude pre-read claim, plus P9 dry-run + scenario diff)

**Fiscal calendar (row-4 dates, per portfolio tab).** CONFIRMED for the four supplied years (FY2023 parked - not verified):

| FY | Row-4 P1 date | Row-4 P13 label | Convention | Source file |
|---|---|---|---|---|
| 2024 | 2024-01-01 | 2024-12-01 (Sunday label; period ends 2024-12-29 per formula) | period START | FY2024_CLOSED |
| 2025 | 2024-12-30 | 2025-11-30 (Sunday label; period ends 2025-12-28) | period START | FY2025_CLOSED |
| 2026 | 2025-12-29 | 2026-11-29 (Sunday label; period ends 2026-12-27) | period START | FY2026_P9 |
| 2027 | 2026-12-28 | 2027-11-28 (Sunday label; period ends 2027-12-26) | period START | both FY2027 files |

Row-4 shows the **Monday** of each period; the ExcelJS Date object for P13 shows the last Sunday-before-P13 label (the visible column header may render as the period-start date or the last-week-of-P12 date depending on cell formatting - the underlying number is period-consistent). Formula math is uniform: 13 x 28 = 364 days per year, contiguous. No 53-week year. FY2027 calendar CONFIRMED from Joe's row-4 dates in both scenario files independently. Resolves PR-3.

**Tab -> account map by row-1 title.** CONFIRMED. The REDS(=Goodyear AZ = CIN - AZ) / CINN(=Cincinnati OH = CIN - OH) collision is real: any loader keyed on tab name alone will swap them. Keyed on row-1 title (`REDS/Cincinnati Reds - Goodyear, AZ` vs `CINN/Cincinnati Reds - Cincinnati, OH`) is unambiguous. Playbook §3.6/§3.7 do NOT document this - F-6.

Row-1 quirks confirmed by the probe:
- FY2024 uses `PFS - REDS`, `PFS - CINN`, etc.
- FY2025 uses `REDS (PFS)`, `CINN (PFS)`, etc.
- FY2026 uses `CIN-AZ`, `CIN-OH`, etc.
- FY2027 uses `CIN - Goodyear, AZ`, `CIN - Cincinnati, OH`, etc.

TBR row-1 city drift confirmed: FY2024 `Dunedin, FL` (TBJ) / `Engelwood, FL` (TBR); FY2025 `Englewood, FL`; FY2026 `Englewood, FL`; FY2027 `Port Charlotte, FL`. Match on team + state, not exact city string.

**Non-portfolio tabs (out of scope unless PR-4 rules otherwise):**
- FY2024: `1731` (Chicago), `Kitchfix Total`, `P&L Across`.
- FY2025: `CHI`, `DTOR (PFS)` (Daytona Tortugas - real FY2025 account, no FY2026 `accounts` row), `CORP`, `Kitchfix Total`, `P&L Across`.
- FY2026 P9: `CORP`, `Kitchfix Total`, `P&L Across`.
- FY2027 (both files, 29 tabs each): `CORP`, `Kitchfix Total`, `COGS per Meal`, 12 `- Data` tabs (Joe's day-by-day meal projections + per-meal prices), `Employer Taxes`, `Travel Budget - Copy Over`, `PFS - New Business`.

**Row layout vs FY2026 loader (fixed rows 21-54 + SG&A scan 60-97):**
- FY2024 portfolio tabs (9): all 16/16 REV/COGS map, SG&A r61..r94, zero unknown codes - EXCEPT `PFS - CINN` at 12/16 (misses at r36, r41, r47, r54 - all Total-rows). F-10 confirms the pre-read row-shift claim. Label-driven scan is safe; fixed-row scan is not.
- FY2025 portfolio tabs (11): all 16/16 REV/COGS map, SG&A r61..r94, zero unknown codes. TBR row-4 P1 date shows `2025-01-01` while other tabs show `2024-12-30` - F-9 (label difference only; period math consistent).
- FY2026 P9 portfolio tabs (11): all 16/16 REV/COGS map, SG&A r61..r94, zero unknown codes.
- FY2027 (both scenario files): all 11 P&L tabs 16/16 REV/COGS, SG&A r61..r94, zero unknown codes.
- FY2023 (parked): different layout + 3 retired codes (`3200.3`, `5017.1`, `5017.4`) - not verified this session; kept on record only.

**FY2026 P9 dry-run.** `node --env-file=.env.local scripts/derive_pnl_actuals.mjs --dry-run --file '<P9>' --periods 1-9 --verified-at 2026-09-15 --verified-by loader:fin2027_w0_p9_dryrun`. Results:
- Parse: clean. 3,167 pnl_actuals rows would upsert.
- Reconciliation: **11/11 accounts PASS, delta 0.00, drift rows 0**.
- Unrecognized codes: **0** (loader would abort if any).
- Skipped rows: 242 (headers/totals as expected).
- Empty cells: 1.
- `kpi_period_status`: would UPDATE 9 rows (P1..P9); `closed_at` untouched per contract.
- P9 rows are new (`pnl_actuals` has 0 P9 rows today); P1..P8 rows exist and would upsert cleanly.

**FY2027 scenario diff (`Full MLB` vs `No MLB`, budget columns P1..P13 only, per-account P&L tabs).** `TOTAL DIFFERING CELLS = 770` (Chat-Claude pre-read: ~768; delta 2).

Compact per-account summary (differing cells / differing codes):

| account_key | diff cells | diff codes | period-span pattern (differing codes highlights) |
|---|---|---|---|
| CIN - AZ (PDC) | 48 | 9 | 2300 P1..P12, 2400.1 P1..P12, spring lines P1..P3 or P2..P3, 5006.1 travel P2-P11 |
| CIN - KY (MiLB) | 7 | 1 | 5006.1 travel P2-P10 only - **MiLB plays through lockout** |
| CIN - OH (MLB) | 130 | 12 | 2400.1 + 3100.1 + 5006.1 + 5017.7 P4..P10 (season) · 3100.2 + 5002.1 + 5002.5 + 5004.8 + 5004.9 + 5016.7 + 5017.3 + 5017.5 full-year (staffing/fixed) |
| STL - FL (PDC) | 40 | 6 | 2400.1 P1..P12 + 3200.2 P1..P12 (food?) + spring P2..P3 + 5006.1 travel |
| STL - MO (MLB) | 142 | 14 | same shape as CIN - OH + 2300 P4..P10 |
| TBJ - FL (PDC) | 59 | 11 | 2300 P1..P13 + 3200.2 P1..P13 + spring P1..P3 + 5006.1 travel |
| TBJ - NY (MiLB) | 7 | 1 | 5006.1 travel P4..P10 only - **MiLB plays through lockout** |
| TBR - FL (PDC) | 37 | 9 | 3200.2 P1..P13 + spring P2..P3 + 5006.1 travel |
| TXR - AZ (PDC) | 51 | 9 | 2300 P1..P12 + 2400.1 P1..P12 + spring P2..P4 + P13, 5006.1 travel |
| TXR - TX - H (MLB) | 133 | 14 | same MLB shape - variable P4..P10 + staffing full-year |
| TXR - TX - V (MLB) | 116 | 14 | same MLB shape; 3100.2 + 5004.8 + 5004.9 differ P3..P11 (season-shifted) |

Pattern confirmed:
- **MiLB accounts (CIN - KY, TBJ - NY)**: only travel (`5006.1`) differs. Consistent with "MiLB plays through a lockout" - no staffing or variable diffs.
- **PDC accounts (CIN - AZ, TBR - FL, STL - FL, TBJ - FL, TXR - AZ)**: differ mostly P1-P3 or P2-P3 (spring training) on variable lines + travel `5006.1` throughout the year + selected full-year lines (`3200.2` for the four with mixed camps; `2300 + 2400.1` for CIN - AZ and TXR - AZ). **Fixed staffing lines (3100.2, 5002.x) do NOT differ on PDC.**
- **MLB accounts (CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V)**: differ P4-P10 on variable lines (revenue, hourly labor, food, packaging) AND full-year P1-P13 on staffing/fixed lines (3100.2 salary, 5002.1 R&M, 5002.5 R&M, 5004.8 professional, 5004.9 professional, 5016.7, 5017.3, 5017.5). This is the composition problem PR-6 flags: variable lines splice cleanly by period; fixed-cost lines do not.

**`gl_codes.is_historical` semantics.** 20 codes carry `is_historical = true` (F-11). All appear only on out-of-scope tabs (`1731`, `CHI`, `CORP`) or FY2023 (parked). Portfolio-tab codes for FY2024/FY2025/FY2026 P9/FY2027 all live in current `kpi_lines`.

**Playbook §3.6 + §3.7 REDS/CINN naming trap.** NOT documented (F-6). §3.6 covers `2400.1 (Home)` vs `2400.2 (Away)` from the chef's perspective; §3.7 covers same-code collisions on reimbursables. The tab-name trap is an unrelated pattern surfaced only in the D32 decision log (Rippling department attribution, not P&L loading).

---

## 12. Open questions for Kevin (blocking W1-W4 only)

1. **What does "live" mean for §1 row 1?** Only TBJ - FL and TBR - FL carry `sc_revenue_live = true`. Should CIN - AZ and TXR - AZ be flipped (they have complete SC data), or is "live" in your phrasing meant operationally rather than as this flag?
2. **PR-1 verdict.** Given F-1 (eight unsafe queries), do you want W1 to (a) fix the queries first in a small PR then load history into the same tables, or (b) land history in a `_history` twin? Recommendation: (a) - the fix list is small and the loaders + PK are already multi-year.
3. **PR-4.** Load any of the non-portfolio tabs (`1731`, `CHI`, `DTOR (PFS)`, FY2027 `CORP`, `Employer Taxes`, `Travel Budget`, `PFS - New Business`, `COGS per Meal`) into a separate table, or ignore for W1/W3? Default per R-4: ignore.
4. **P9 rerun timing.** The FY2026 P9 workbook parses cleanly (§11). When do you want the loader run against P9? It is a straightforward `--periods 1-9` invocation on the existing loader.
5. **F-3 / F-5 for W2.** If the SC 2023-2025 upload lands into `sc_daily_projections` / `sc_daily_actuals` before we seed historical `sc_service_prices` rows, the `sc_daily_revenue` view will silently apply 2026 prices to historical dates. Should W2 gate on price-seed-first, or should we lift the view to return NULL when out of price coverage?

---

## 13. Recommended shape of W1 (describe, hours, do not build)

Chat-Claude's proposed shape, validated + amended:

- **(a) Multi-year fiscal calendar.** Add `fiscal_periods(fiscal_year INT, period_no INT, start_date DATE, end_date DATE, PRIMARY KEY (fiscal_year, period_no))`. Seed FY2024, FY2025, FY2026, FY2027 from the row-4 dates verified in §11. Rewrite `periods.js` `periodOf` to read the table (fall back to formula when the table row is missing, so the client still works if the DB is unreachable). Remove `FY_START_ISO / FY_END_ISO` constants. **Hours: 6-10h** (table + seed + rewrite + tests).
- **(b) FY2026 P9 load.** Rerun the existing loader with `--file <P9> --periods 1-9 --verified-at 2026-09-15 --verified-by loader:pnl_actuals_p9_<date>`. Dry-run in §11 shows this is safe: 11/11 recon PASS, 0 unknown codes, 3,167 upserts. **Hours: 0.5h** (one command + review the recon table).
- **(c) Sibling loader `load_pnl_history.mjs`.** Shares `scripts/lib/reconcile_pnl.mjs` (extracted from `derive_pnl_actuals.mjs:456-590`). Label-driven scan (not fixed-row) to handle the `PFS - CINN` row-shift and any similar shape drift in other historical tabs. Per-year tab map keyed on row-1 titles, not tab names, per F-6. Loads FY2024 + FY2025 P1..P13 into `pnl_actuals`. **Hours: 8-16h** including tests + shared module + probe.
- **(d) `kpi_period_status` seed for FY2024, FY2025.** 13 rows per year, `closed_at` from row-4 dates + 27 days, `verified_at` from load timestamp. Migration SQL that seeds after (a) and before (c). **Hours: 2h.**
- **(e) Read-path fixes for F-1.** One PR: 5 hardcoded `2026` labor queries + 3 no-predicate queries. Parameterize where a `fiscalYear` is available in scope; add `.eq("fiscal_year", 2026)` where not (safe stopgap while multi-year data isn't published to the UI). This ships BEFORE (c). **Hours: 6-10h** including tests.
- **(f) FY2023 out of W1 entirely** per R-10. Recorded in §11.
- **(g) FY2027 scenario layer (PR-5)** is W3, not W1. Nothing found in this recon changes the design in the master scope doc. The 770-differing-cells map (§11) confirms the PR-5 shape (bookends + exposure) and the PR-6 need (partial-lockout composition rule for MLB fixed lines).

**Total W1 hours (a-e, no FY2027 work): 22.5 - 38.5h.**

---

## 14. Probe inventory

Every script written this session (all under `scripts/_probe_fin2027_*.mjs`, read-only, no dollar literals printed):

| script | reads | sample invocation |
|---|---|---|
| `_probe_fin2027_env_presence.mjs` | `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY` | `node --env-file=.env.local scripts/_probe_fin2027_env_presence.mjs` |
| `_probe_fin2027_db_connect.mjs` | `kpi_lines` (count) | `node --env-file=.env.local scripts/_probe_fin2027_db_connect.mjs` |
| `_probe_fin2027_tab_list.mjs` | workbook `.worksheets[].name` only | `node scripts/_probe_fin2027_tab_list.mjs '<xlsx>' [...]` |
| `_probe_fin2027_workbook_shape.mjs` | workbook row-1, row-4, REV/COGS rows, SG&A block; `kpi_lines` catalog | `node --env-file=.env.local scripts/_probe_fin2027_workbook_shape.mjs '<xlsx>' [...]` |
| `_probe_fin2027_scenario_diff.mjs` | portfolio-tab budget columns in two FY2027 files | `node --env-file=.env.local scripts/_probe_fin2027_scenario_diff.mjs '<FULL_MLB>' '<NO_MLB>'` |

The existing FY2026 loader was also invoked in dry-run mode for the P9 workbook (§11); no probe was added for it.

---

## 15. Reading log

Files consulted in this session (one line per file; every doc claim in this report is either evidence-tagged inline or lands in this log):

**Repo docs**
- `CLAUDE.md` - working-environment + Danger Zones + `.env*` USE-vs-SEE rule (2026-08-24)
- `docs/HOW_WE_WORK.md`, `docs/BUILD_ACCURACY_PROTOCOL.md` (session-binding standards)
- `docs/KPI_DASHBOARD_PLAYBOOK.md` §2 (account model), §3 (chart of accounts + activation), §3.6/§3.7 (naming trap gaps), §4 (revenue archetypes + per-account readiness + rulings D17/D26/D32/R-3/R-14/R-15/R-20), §4.5 (labor budget authority), §5.2 (reimbursables reroute)
- `docs/KPI_MASTER_SCOPE.md` §2 (proven metrics + P8 sentinels), §3.5, §5.5 (fiscal-year safety), §7 (open items)
- `docs/SC_MONEY_MODEL.md` (canonical since 2026-07-09), §K (per-account fee summary)
- `docs/SC_KPI_PUSH_CONTRACT.md` (doc drift F-7)
- `docs/SC_BILLING_MODEL_AUDIT.md`, `docs/SC_SPREADSHEET_MAPPING.md`, `docs/SC_PDC_PHASES.md`, `docs/modules/SERVICE_CALENDAR.md`
- `docs/ACCOUNT_MODEL_MATRIX.md`, `docs/ACCOUNT_SERVICES_BRIEF.md`
- `docs/BUSINESS_NOTES.md` (finance + SC + TXR-V sections)
- `docs/audits/SC_PROJECTION_CALIBRATION_2026-08-20.md`
- `docs/audits/OVERVIEW_REVENUE_DISCOVERY_2026-08-28.md`, `docs/audits/OVERVIEW_BUILD_ALIGNMENT_2026-08-31.md`
- `docs/pricing-summit/README.md`, `NORTH_STAR.md`, `LEDGER.md`, `BILLING_TERMS_MATRIX.md`, `PRICE_BOOK.md`, `CONFLICT_REGISTER.md`
- `docs/pricing-summit/CONTRACT_DIGEST_{CIN-AZ,CIN-KY,CIN-OH,STL-FL,STL-MO,TBJ-FL,TBJ-NY,TBR-FL,TXR-AZ,TXR-TX-H,TXR-TX-V,BGC}.md`
- `docs/SC_CONTRACT_BILLING_SUMMARY.md` (RESOLVED BILLING DECISIONS)
- `docs/ARCHITECTURE.md` (MDX-vs-PG boundary)
- `docs/opd/OPD_CC_HANDOFF.md`, `docs/OPD_PLAN.md`
- Migrations: `kpi-1-spine.sql`, `kpi-1b-activation-fk.sql`, `kpi-2-budget-values.sql`, `kpi-2b-grants.sql`, `pnl-1-actuals-and-status.sql`, `pnl-2-revenue-model.sql`, `sc-1`, `sc-1b`, `sc-5`, `sc-6b`, `sc-8a`, `sc-8b`, `sc-8c`, `sc-11`, `sc-20`, `sc-21`, `sc-25`, `sc-30`

**Code files (KPI + SC + loaders)**
- `src/app/kpi/labor/lib/periods.js`, `src/app/kpi/labor/lib/accounts.js`
- `src/lib/kpi/overview/resolver.js`, `src/lib/kpi/overview/pnl-loader.js`, `src/lib/kpi/shared/periodBasis.js`
- `src/lib/purchasing/loaders.js`
- `src/app/api/kpi/overview/route.js`, `src/app/api/kpi/labor/route.js`, `src/app/api/kpi/purchasing/route.js`
- `src/lib/labor/labor-batr.js`, `src/lib/labor/dailyRangeBody.js`, `src/lib/labor/loaders.js`, `src/lib/labor/salaryBoard.js`, `src/lib/labor/homestandResolver.js`
- `src/app/kpi/labor/page.js`, `src/app/kpi/purchasing/page.js`
- `src/app/api/service-calendar/route.js` (BACKDATE_FLOOR sites)
- `scripts/derive_pnl_actuals.mjs`, `scripts/load_kpi_budgets_2026.mjs`, `scripts/verify_budget_seed_vs_xlsx.mjs`, `scripts/_seed_sc_from_xlsx.mjs`, `scripts/_seed_sc_labor_budgets.mjs`

**Live tables probed (dhkhvaokmtsfscnwnbum, service-role, read-only)**
- `accounts`, `kpi_lines`, `kpi_line_activation`, `kpi_account_flags`, `gl_codes`
- `kpi_budgets`, `pnl_actuals`, `kpi_period_status`, `inventory_adjustments`
- `sc_labor_budgets`, `labor_actuals`, `labor_actuals_latest`
- `purchasing_actuals`, `v_purchasing_by_site_period`
- `sc_daily_projections`, `sc_daily_actuals`, `sc_day_metadata`
- `sc_service_prices`, `sc_fee_schedule`, `sc_phase_calendar`, `sc_homestand_schedule`
- `sc_daily_revenue` (viewdef), `sc_month_summary` (viewdef)
- `sc_qbo_account_map`, `user_accounts`
- `information_schema.columns` (for fiscal_year/period_no column scan)

**Workbooks probed (paths not committed; contents printed as labels+dates+counts only)**
- FY2024 closed (`Budget vs Actual (2024) P13 (2.03.25) SLT (2).xlsx`)
- FY2025 closed (`Budget vs Actual (2025) (SLT) P13 (01.21.26) (2).xlsx`)
- FY2026 P9 (`Budget vs Actual (SLT) (2026) P9 (9.15.26).xlsx`)
- FY2027 Full MLB (`Budget vs Actual (2027) - Full MLB - 9.7.26 (1).xlsx`)
- FY2027 No MLB (`Budget vs Actual (2027) - No MLB - 9.7.26 (1).xlsx`)
