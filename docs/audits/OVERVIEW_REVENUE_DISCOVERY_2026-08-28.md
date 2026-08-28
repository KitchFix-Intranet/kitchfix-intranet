# Overview revenue discovery - 2026-08-28

> READ-ONLY discovery for the Master KPI chat's Overview design. Measures what the database can and cannot answer today for every revenue line on every account, before the Overview is built.
> All claims labelled `[ran]` or `[code-read]` per BUILD_ACCURACY_PROTOCOL C1. Dollar figures come from measured operational amounts only; `kpi_budgets` values never appear in this doc per the loader-pattern rule.

---

## Executive summary

- **Playbook §5.7 fee-account price contamination is LIVE on all five fee accounts.** `[ran]` The fix was scoped as PR 5 in the playbook but never shipped - no PR, migration, or code change has landed. `sc_service_prices` still holds a single `projected` kind per service (no `actual` kind), so `sc_daily_revenue` `actual_revenue` (which COALESCEs to the projected price when `pr_act` is null) is contaminated on every fee account except where actual_count is zero.
- **Verdict per account (§5.7):** every fee account is CONTAMINATED at the schema layer. Only actual_count > 0 turns contamination into visible revenue: **CIN - OH $4,671.76 actual_revenue FYTD (contaminated)**, **STL - FL $466,216.00 actual_revenue FYTD (contaminated)**, **STL - MO $0 actual (structurally exposed, latent)**, **TXR - TX - H $0 actual (latent)**, **TXR - TX - V $0 actual (latent, plus $149,496.31 projected_revenue on prices designed as $0)**.
- **`sc_fee_schedule` cadence-question answer: NO.** `[code-read]` `[ran]` The schedule alone cannot produce a per-period P1-P13 fee-revenue figure. The table carries `payment_cadence` (`monthly-6` / `monthly-7` / `quarterly` / `annual`) as an INFORMATIONAL enum with no compute contract (documented in `docs/migrations/sc-5-fee-schedule.sql:76-79`). No installment table, no per-period allocation, no start-month column. Cadence lives in docs + contracts only.
- **`pnl_actuals` table is ABSENT.** `[ran]` Playbook build item 2 has not shipped. There is no P&L actuals lookback source in Postgres today. Revenue actuals for the Overview must come from the operational sources analysed below.
- **`sc_labor_sold_revenue` table is ABSENT.** `[ran]` The playbook §9.5 sc-28 migration ("sold revenue to PG") never landed. The `sc-28-stl-fl-away-dining` migration reuses the same PR number for a different piece (STL - FL away-dining schedule). TXR - TX - V direct-sales revenue is still Sheets-only, still read by the row-order-dependent `soldRevenueMap` at `src/app/api/ops/route.js:176-186`.

---

## Part A - Playbook §5.7 fee-account price contamination

### A.1 Did the fix ship? `[code-read]`

**No.** Search evidence:

- `gh pr list --search "fee-account price"` -> zero matches. `[ran]`
- `gh pr list --search "phantom revenue"` -> zero matches. `[ran]`
- `git log --all --grep="5.7\|phantom revenue\|fee-account price\|contamination\|price contamination"` -> zero matches. `[ran]`
- Grep of `src/` for `phantom revenue` -> zero matches. `[ran]`
- Grep of `docs/migrations/` for `sc_labor_sold_revenue\|pnl_actuals\|labor_sold_revenue` -> zero matches. `[ran]`
- Only `sc_service_prices` inserts of `price_kind='actual'` in the migration set land in `docs/migrations/sc-8b-actual-prices-and-view.sql:167` and are gated by the WHERE at `sc-8b-actual-prices-and-view.sql:200-207` which SKIPS `is_flat_fee` services entirely (`AND NOT s.is_flat_fee`). No later migration adjusts the seed. `[code-read]`
- Only revenue-adapter code that would be affected sits behind a `PR 5` label in the playbook status table at `docs/KPI_DASHBOARD_PLAYBOOK.md:555` and is not marked shipped. `[code-read]`

### A.2 `sc_service_prices` for the five fee accounts `[ran]`

54 rows total across 27 services on the five fee accounts. **Every service has exactly two rows, both `price_kind = 'projected'`**: one seed at 2026-01-01 at the SF-post-discount rate, one at 2026-06-16 overriding to $0.00. **Zero `price_kind = 'actual'` rows** on any fee-account service.

| Account | Alive services | Total prices | Any `actual` rows? |
|---|---|---|---|
| CIN - OH | 4 | 8 | 0 |
| STL - FL | 11 | 22 | 0 |
| STL - MO | 4 | 8 | 0 |
| TXR - TX - H | 4 | 8 | 0 |
| TXR - TX - V | 4 | 8 | 0 |

Every service's two rows: `projected @ $25.9542 eff 2026-01-01` and `projected @ $0.0000 eff 2026-06-16` (with STL - FL variants at $26, $40, $25000, and $0 for Snack).

### A.3 View mechanics `[code-read]`

`docs/migrations/sc-8b-actual-prices-and-view.sql:241-313` defines `sc_daily_revenue`:
- `pr_proj` LATERAL picks latest `price_kind='projected'` on `effective_date <= service_date`.
- `pr_act` LATERAL picks latest `price_kind='actual'` on `effective_date <= service_date`.
- `actual_revenue = actual_count * COALESCE(pr_act.price, pr_proj.price, 0)` (line 269).

**The COALESCE is the leak.** With no `actual` rows on any fee account, `pr_act.price` is always NULL, so the view falls back to `pr_proj.price` (the projected/planning rate) for actual_revenue. On any date before 2026-06-16, that projected rate is $25.9542 (or the STL - FL variant). After 2026-06-16, both projected and actual coalesce to $0.

### A.4 Live measurement: sc_daily_revenue by account, FYTD `[ran]`

Range: 2025-12-29 (FY2026 P1 start per `src/app/kpi/labor/lib/periods.js:19`) through 2026-08-28.

| Account | Rows | Rows with proj_rev > 0 | Rows with act_rev > 0 | SUM proj_rev FYTD | SUM act_rev FYTD |
|---|---|---|---|---|---|
| CIN - OH | 520 | 108 | 3 | $168,183.35 | **$4,671.76** |
| STL - FL | 2,021 | 452 | 184 | $1,593,360.00 | **$466,216.00** |
| STL - MO | 528 | 148 | 0 | $203,584.90 | $0.00 |
| TXR - TX - H | 500 | 96 | 0 | $149,496.31 | $0.00 |
| TXR - TX - V | 500 | 96 | 0 | $149,496.31 | $0.00 |

Sample row (CIN - OH): `date=2026-04-01 svc="Post-Game" proj_price=$25.9542 act_price=$25.9542 proj_ct=60 act_ct=null proj_rev=$1557.25 act_rev=$0.00`. On the three rows where `actual_count` was populated (before 2026-06-16), `actual_revenue` fires at $25.9542/meal and lands in the FYTD $4,671.76.

Sample row (STL - FL): `date=2026-01-26 svc="Lunch" proj_price=$26.00 act_price=$26.00 proj_ct=70 act_ct=0 proj_rev=$1820.00 act_rev=$0.00` - zero here because the actual_count is 0, but for the 184 STL - FL rows where actual_count > 0, revenue fires at $26.00 or $40.00 per meal (breakfast/lunch pre-6/16 rates), summing to $466,216.00.

### A.5 Verdict per account

| Account | Verdict | Measured contamination FYTD |
|---|---|---|
| CIN - OH | **CONTAMINATED** | $4,671.76 in actual_revenue on 3 rows |
| STL - FL | **CONTAMINATED** | $466,216.00 in actual_revenue on 184 rows |
| STL - MO | CONTAMINATED (latent) | $0 actual today (no actual_count > 0 rows); $203,584.90 projected_revenue |
| TXR - TX - H | CONTAMINATED (latent) | $0 actual today; $149,496.31 projected_revenue |
| TXR - TX - V | CONTAMINATED (latent) | $0 actual today; $149,496.31 projected_revenue on services designed as $0 |

**Every fee account is at risk. Two are actively bleeding contamination into `actual_revenue`. The Overview may NOT read `sc_daily_revenue` for fee accounts without an upstream fix.**

---

## Part B - `sc_fee_schedule` live state

### B.1 Every row, every column `[ran]`

5 rows, one per fee account, effective_date 2026-01-01 across all.

| account_key | amount | eff_date | period_type | payment_cadence | covered_by | changed_by |
|---|---|---|---|---|---|---|
| CIN - OH | 376,686 | 2026-01-01 | annual | monthly-6 | - | kf-fee-escalation-2026-07 |
| STL - FL | 1,400,000 | 2026-01-01 | annual | quarterly | - | seed-script |
| STL - MO | 489,497 | 2026-01-01 | annual | monthly-6 | - | kf-fee-escalation-2026-07 |
| TXR - TX - H | 604,032 | 2026-01-01 | annual | monthly-6 | - | seed-script |
| TXR - TX - V | 0 | 2026-01-01 | annual | (null) | TXR - TX - H | seed-script |

### B.2 Escalation status `[ran]`

- **CIN - OH:** ESCALATED. amount = $376,686 (matches playbook's escalated figure). Reason line: `"CPI escalation per contract §2.a: base $362,500 → $376,686 (2026 CPI-U Food Away from Home, Aug 2024→Aug 2025)"`. changed_by = `kf-fee-escalation-2026-07`. created_at = 2026-06-19T15:53:30Z.
- **STL - MO:** ESCALATED. amount = $489,497 (matches playbook). Reason: `"CPI escalation per contract §2.d (CUUR0000SEFV, Aug 2025): base $473,000 → $489,497 = $439,497 meal services ($73,249.50×6) + $50,000 road food"`. changed_by = `kf-fee-escalation-2026-07`.

Only two rows are currently on `sc_fee_schedule` for each of those accounts (there is no separate "base + escalated" history in the table). The escalation was applied as an in-place seed rather than as a new dated row on top of an existing base row. **This means the audit trail for the change lives in `sc_config_changelog` (per sc-5-fee-schedule.sql:23-29 design), not in `sc_fee_schedule` itself.** Not measured this pass.

### B.3 The cadence question `[code-read]` `[ran]`

**Cannot produce a per-period P1-P13 fee figure from the schedule alone.**

- `sc_fee_schedule` columns: `id, account_key, amount, effective_date, period_type, payment_cadence, covered_by_account_key, reason, requested_by, changed_by, created_at`. `[ran]`
- `period_type` CHECK: `('annual')` only. `[code-read docs/migrations/sc-5-fee-schedule.sql:69-71]`
- `payment_cadence` CHECK: `NULL OR IN ('monthly-6', 'monthly-7', 'quarterly', 'annual')`. `[code-read docs/migrations/sc-5-fee-schedule.sql:76-79]`
- **Migration comment on `payment_cadence` (`sc-5-fee-schedule.sql:72-75`):** "Informational - the operator's mental model for how the annual amount gets paid out. The future KPI dashboard can use this for 'next installment due X' UX. **Schema does not drive any compute from this field.**"

**Missing to derive per-period revenue from the schedule:**
1. Start-month / first-installment date. `monthly-6` for CIN - OH means March-August 2026 per contract, but the schedule holds only `2026-01-01` as effective date. Nothing records "installments start in March".
2. A per-period allocation table (or an equivalent installment-count column tied to the fiscal calendar).
3. A recognition-vs-billing distinction. Playbook §4.2 D1 says fees book at the P&L per line 2400.1 uniformly; the P&L does its own smoothing. The schedule has no signal to reproduce that smoothing.

Cadence rules live in each account's OPD/contract-summit files (per `docs/ACCOUNT_MODEL_MATRIX.md` lines 32-40) plus `SC_MONEY_MODEL.md` / `SC_CONTRACT_BILLING_SUMMARY.md`. Nothing in Postgres binds a period_no to a fee installment.

---

## Part C - `kpi_budgets` revenue inventory (counts + presence only)

### C.1 Schema `[ran]`

- `kpi_budgets` columns: `account_key, line_code, fiscal_year, period_no, amount, source_doc, loaded_at`.
- `kpi_line_activation` columns: `account_key, line_code, fiscal_year, active`.

### C.2 `kpi_budgets` FY2026 revenue-line row COUNTS `[ran]`

Total revenue-line budget rows FY2026: 715 (= 11 accounts x 5 lines x 13 periods). Every account carries a budget row for every one of the five revenue lines in every one of the 13 periods.

| Account | 2200 | 2300 | 2400.1 | 2400.2 | 2600 |
|---|---|---|---|---|---|
| CIN - AZ | 13 | 13 | 13 | 13 | 13 |
| CIN - KY | 13 | 13 | 13 | 13 | 13 |
| CIN - OH | 13 | 13 | 13 | 13 | 13 |
| STL - FL | 13 | 13 | 13 | 13 | 13 |
| STL - MO | 13 | 13 | 13 | 13 | 13 |
| TBJ - FL | 13 | 13 | 13 | 13 | 13 |
| TBJ - NY | 13 | 13 | 13 | 13 | 13 |
| TBR - FL | 13 | 13 | 13 | 13 | 13 |
| TXR - AZ | 13 | 13 | 13 | 13 | 13 |
| TXR - TX - H | 13 | 13 | 13 | 13 | 13 |
| TXR - TX - V | 13 | 13 | 13 | 13 | 13 |

Zero cells missing. Dollar values not enumerated per the loader-pattern rule.

### C.3 `kpi_line_activation` `[ran]`

55 rows for revenue lines FY2026 (= 11 accounts x 5 lines). Every row `active = true`. Zero inactive revenue-line activation rows on any account.

### C.4 Cross-check with `ACCOUNT_MODEL_MATRIX.md` + playbook §4 `[code-read]`

**Playbook §3.3 activation rule (line 91):** "A line is applicable to an account if the row exists on that account's P&L tab, regardless of budget value." Under this rule, "every account carries every revenue line" is CONSISTENT with the observed budget-and-activation presence.

**Disagreements to name (per brief - report only, do not resolve):**

1. **`2400.1` vs `2400.2` for TXR - TX - V.** Decision log D3 (`docs/KPI_DASHBOARD_PLAYBOOK.md:572`) says `2400.2` is "TXR-V's revenue line in the tracker." But `ACCOUNT_MODEL_MATRIX.md:40` says the P&L books `2400.1` (`Season-forecast $312,000 = 81 games x ~$3,852/game (2400.1 per P&L)`) - flagged there as FLAG A-14. The playbook itself lists this as an open question ("With Joe #4," `docs/KPI_DASHBOARD_PLAYBOOK.md:637`). Both lines are present as budget rows in `kpi_budgets` for TXR - TX - V.
2. **`2300 Service Charges` present on 11 of 11 accounts as budget rows** even though playbook §4.4 says "2300 is in no PG table by design" and only 5 accounts have the PFS Service Fees workbook per the same section. Under the §3.3 activation rule this is expected - the P&L tab carries the row on every account - but the Overview cannot source an actual for a 2300 budget row without a workbook or 2300 actuals lane. See Part E.
3. **`2600 Consulting` present as a budget row on 11 of 11 accounts.** Playbook §3.4 definition (`docs/KPI_DASHBOARD_PLAYBOOK.md:111`) is "One-off consulting fees to teams" - by nature intermittent. No account is called out in the docs as a live 2600 revenue producer. Report as observed; no resolution attempted.

---

## Part D - SC actuals data state

Schema `[ran]`:

- `sc_daily_actuals` columns: `id, account_key, service_id, service_date, actual_count, created_by, created_at, updated_by, updated_at`.
- `sc_daily_projections` same shape with `projected_count` instead of `actual_count`.

### D.1 Per-account snapshot of `sc_daily_actuals` `[ran]`

| Account | Rows | Date range | Per-month distribution | created_by set | Burst signature (top-day % of created_at) | Distinct actual_count values |
|---|---|---|---|---|---|---|
| CIN - AZ | 2,855 | 2025-12-29 .. 2026-08-25 | 39/403/364/403/389/403/302/364/188 | `import-script`, `k.fietek@...`, `spreadsheet_seed` | 2026-06-15 = 2,132/2,855 (74.7%) | 63 |
| CIN - KY | 502 | 2026-03-23 .. 2026-07-14 | 45/150/155/140/12 | `import-script`, `k.fietek@...` | 2026-06-16 = 460/502 (91.6%) | 8 |
| CIN - OH | 61 | 2026-06-15 .. 2026-07-12 | 25/36 | `k.fietek@...` only | 2026-07-09 = 61/61 (100.0%), span 0.1h | 5 |
| STL - FL | 653 | 2025-12-29 .. 2026-07-18 | 30/310/152/14/64/78/-/5 | `import-script`, `k.fietek@...` | 2026-06-15 = 634/653 (97.1%) | 75 |
| STL - MO | 0 | - | - | - | - | - |
| TBJ - FL | 948 | 2026-01-05 .. 2026-07-27 | 109/182/170/138/120/217/12 | `import-script`, `k.fietek@...` | 2026-06-15 = 808/948 (85.2%) | 70 |
| TBJ - NY | 271 | 2026-03-23 .. 2026-07-27 | 42/84/84/42/19 | `import-script`, `k.fietek@...` | 2026-06-15 = 252/271 (93.0%) | 7 |
| TBR - FL | 709 | 2026-01-03 .. 2026-07-30 | 79/109/148/86/105/69/113 | `import-script`, `k.fietek@...` | 2026-06-15 = 654/709 (92.2%) | 48 |
| TXR - AZ | 2,298 | 2026-01-05 .. 2026-08-10 | 216/324/403/390/403/231/298/33 | `import-script`, `k.fietek@...`, `spreadsheet_seed` | 2026-06-15 = 1,918/2,298 (83.5%) | 74 |
| TXR - TX - H | 0 | - | - | - | - | - |
| TXR - TX - V | 0 | - | - | - | - | - |

### D.2 `sc_daily_projections` per-account snapshot `[ran]`

Every account has projections through the season. Row counts:
- CIN - AZ: 4,641 (2025-12-29 .. 2026-12-20)
- CIN - KY: 945 (2026-03-23 .. 2026-09-27)
- CIN - OH: 612 (2026-03-26 .. 2026-09-27)
- STL - FL: 2,679 (2025-12-29 .. 2026-12-20)
- STL - MO: 624 (2026-03-26 .. 2026-09-27)
- TBJ - FL: 4,991 (2025-12-29 .. 2026-12-20)
- TBJ - NY: 1,134 (2026-03-23 .. 2026-09-27)
- TBR - FL: 4,588 (2025-12-29 .. 2026-12-29)
- TXR - AZ: 1,968 (2026-01-05 .. 2026-11-22)
- TXR - TX - H: 596 (2026-03-30 .. 2026-09-25)
- TXR - TX - V: 596 (2026-03-30 .. 2026-09-25)

### D.3 Per-account real-vs-test read

- **CIN - AZ** - **mixed/test-leaning.** 74.7% of rows carry a created_at on 2026-06-15. The `import-script` and `spreadsheet_seed` writers dominate. Real chef entry (`k.fietek@kitchfix.com`) is present but a minority. Test-signature: single-day burst on the seed date.
- **CIN - KY** - **test-heavy.** 91.6% burst on 2026-06-16. Two writers only, one is the import script.
- **CIN - OH** - **real (small window).** 100% of rows entered same day 2026-07-09 within a 0.1h span - looks like a single sit-down entry session by Kevin. No import script; only 61 rows across late June + July. Reads as first-look, real data.
- **STL - FL** - **test-heavy.** 97.1% burst on the 2026-06-15 seed date. `import-script` is a writer. Cadence tapers off after May.
- **STL - MO** - **empty.** Zero rows.
- **TBJ - FL** - **test-leaning.** 85.2% burst on 2026-06-15; `import-script` present. Full-season coverage in projections but actuals concentrated in the seed window.
- **TBJ - NY** - **test-heavy.** 93.0% burst on 2026-06-15.
- **TBR - FL** - **mixed / more real than most.** 92.2% burst on 2026-06-15 (still a heavy import artifact) but 48 distinct actual_count values across 709 rows and 7 months of coverage suggest ongoing real entry alongside the seed.
- **TXR - AZ** - **mixed/test-leaning.** 83.5% burst on 2026-06-15; three writers including `spreadsheet_seed`. Continues through August (33 August rows).
- **TXR - TX - H** - **empty.**
- **TXR - TX - V** - **empty.**

**Kevin's characterization (test data pending real seeding before end-of-month training) is consistent with the observed 2026-06-15 / 2026-06-16 mass-import signature across CIN-AZ, CIN-KY, STL-FL, TBJ-FL, TBJ-NY, TBR-FL, TXR-AZ.** Post-seed edits by Kevin exist but are the minority for every account except CIN - OH.

---

## Part E - 2300 Service Charges

### E.1 Table presence `[ran]`

Probed the schema cache for eight candidate names: `service_charge_actuals`, `service_fee_actuals`, `sc_service_charge`, `pnl_service_charges`, `service_charges`, `kpi_service_charges`, `kpi_2300`, `kpi_2300_actuals`. **All ABSENT** (`PGRST205: Could not find the table 'public.<name>' in the schema cache`).

The only 2300-adjacent table in Postgres is `sc_fee_schedule`, which holds the flat annual fee (books to `2400.1` per playbook D1), not the `PFS Service Fees 2026.xlsx` workbook data that lands on `2300`.

### E.2 Upload lane for the PFS Service Fees workbook `[code-read]`

- `grep -rln "PFS Service Fees\|service.charges.*upload\|upload.*service.charges\|pnl_upload\|pnl_actuals"` in `src/` -> zero matches. `[ran]`
- No route under `src/app/api/` handles a service-charges upload.
- No parser under `src/lib/` targets the workbook.
- Playbook D8 (`docs/KPI_DASHBOARD_PLAYBOOK.md:577`): "Upload monthly, append-only." The commitment exists in doc, the lane does not exist in code.

### E.3 What the Overview can source 2300 actuals from today

**Nothing.** No table holds them, no lane ingests them. Budget rows for 2300 are present on all 11 accounts (Part C.2), but the actual side is a blank surface.

---

## Part F - TXR - TX - V revenue state

### F.1 `labor_sold_revenue` reader/writer today `[code-read]`

**Still Sheets.** No Postgres table.

- Reader: `src/app/api/ops/route.js:881` reads Sheets `COLLECTION.labor_sold_revenue` via `safeRead(SHEET_IDS.COLLECTION, "labor_sold_revenue")`, wraps into `soldRevenueMap[hsId]` at lines 176-188 by plain assignment in a loop (last-write-wins by row order, ignores the recorded Timestamp column).
- Writer: `src/app/api/ops/route.js:1274` `appendRowSA(SHEET_IDS.COLLECTION, "labor_sold_revenue", row)` in the `submit-sold-revenue` action; row shape `[account, homestandId, soldRevenue, email, ISO-timestamp]`.
- Timestamp field is written but never read.

### F.2 Did sc-28 (sold revenue to PG) ship? `[ran]`

**No.** Table presence probe (`.select("*").limit(1)`):
- `sc_labor_sold_revenue` -> ABSENT (`PGRST205`)
- `sc_labor_sold_revenue_latest` -> ABSENT (`PGRST205`)
- `labor_sold_revenue` -> ABSENT (`PGRST205`)
- `sc_txr_sold_revenue` -> ABSENT (`PGRST205`)

The migration filename `sc-28-stl-fl-away-dining.sql` reuses the "sc-28" number for a different piece of work (STL - FL away-dining schedule per its docblock at line 1-19). The playbook §9.5 sc-28 sold-revenue migration was never authored.

### F.3 Row-order vs timestamp resolution `[code-read]`

**Still row-order.** `src/app/api/ops/route.js:176-188` iterates the Sheets rows and overwrites `soldRevenueMap[hsId]` without any timestamp sort. Playbook N11 (`docs/KPI_DASHBOARD_PLAYBOOK.md:35, 442`) still describes the exact live behavior. Naive `SUM(SoldRevenue)` still returns 111% overstated per the playbook's own worked example.

### F.4 Homestand count for TXR - TX - V through P8 `[ran]`

`sc_homestand_schedule` columns: `id, account_key, service_date, day_of_week, day_type, opponent, homestand_id, created_at, game_pk, game_time, day_night, is_doubleheader, opponent_team_id`.

Total rows for TXR - TX - V: **164** (across the full season - a mix of `HOME`, `AWAY`, and `EXHIBITION` day_types). Not filtered to homestand entries alone in this pass; the table stores rows per service_date and rolls up by `homestand_id`. A homestand-only count would need `homestand_id NOT NULL` filter + distinct-on `homestand_id`.

The playbook's P4-P7 sold-revenue table (`docs/KPI_DASHBOARD_PLAYBOOK.md:207-217`) shows P4=$28,758, P5=$44,718, P6=$51,734, P7=$79,068 - all four periods where TXR-V had visible sold revenue in Sheets. Not solving the -8.7% P&L gap per brief.

---

## Part G - P&L actuals side

### G.1 `pnl_actuals` presence `[ran]`

- `pnl_actuals` -> ABSENT (`PGRST205: Could not find the table 'public.pnl_actuals' in the schema cache`).
- `kpi_pnl_actuals` -> ABSENT.
- `kpi_actuals` -> ABSENT.

### G.2 Consequence

Playbook build item 2 (`docs/KPI_DASHBOARD_PLAYBOOK.md:552`, "`pnl_actuals` + parser + upload + `sc_period_locks`" - "next") has NOT shipped. **The Overview has no P&L-actuals lookback source in Postgres.** Revenue actuals for the Overview must come from the operational sources above:

- `sc_daily_revenue` per-meal actual_revenue for the six per-meal accounts (with the Part D test-data caveat)
- `sc_fee_schedule` for the four fee accounts (with the Part B cadence blocker)
- Sheets `labor_sold_revenue` for TXR - TX - V (via `soldRevenueMap`, with the Part F row-order caveat)
- Nothing at all for 2300, 2400.2 on non-TXR-V accounts, or 2600 Consulting

---

## Part H - Revenue rollup dry run (structure only)

### H.1 TBR - FL per-meal, per-period P1-P8 `[ran]`

**Structure that works today:**
1. Read `sc_daily_revenue` filtered on `account_key = 'TBR - FL'` and `service_date` in FY2026-to-today (2025-12-29 .. 2026-08-28).
2. Group by view column `period` (populated from `sc_day_metadata` via the view's LEFT JOIN, `docs/migrations/sc-8b-actual-prices-and-view.sql:311-313`).
3. Sum `actual_revenue` per period.

Measured `[ran]`:

| Period | Rows | Days | SUM projected_revenue | SUM actual_revenue |
|---|---|---|---|---|
| P1 | 418 | 28 | $15,652.25 | $14,628.00 |
| P2 | 356 | 28 | $257,475.39 | $302,345.94 |
| P3 | 278 | 28 | $652,755.18 | $543,116.33 |
| P4 | 423 | 28 | $185,024.50 | $155,557.89 |
| P5 | 426 | 28 | $166,590.00 | $121,621.10 |
| P6 | 436 | 28 | $160,155.00 | $116,462.97 |
| P7 | 427 | 28 | $120,153.44 | $116,931.53 |
| P8 | 414 | 28 | $124,432.88 | $64,178.25 |
| P9 (partial) | 247 | 19 | $86,087.81 | $0.00 |

Zero rows with `period IS NULL` for TBR - FL in that range. Every day is period-mapped.

**Blockers named:**

- **B-H1: partial-period P9.** 19 of 28 days present (through 2026-08-28 vs P9 end ~2026-09-21). Any Overview must render P9 as `not-reported` per the playbook §6 rule and not include it in totals.
- **B-H2: actuals-vs-projections divergence per Part D.** TBR - FL is mixed but leans real. Any "actual_revenue" tile inherits the "seeded 2026-06-15 then edited" data-quality signature. Overview should surface `data_source: service_calendar` per playbook §7.
- **B-H3: reconciliation delta vs P&L.** Playbook §4.3 says TBR - FL reconciles 2.7%. Cannot verify without `pnl_actuals` (Part G ABSENT).
- **B-H4: 2400.1 vs 2400.2 line binding.** The sum here is a `sc_daily_revenue.actual_revenue` figure that carries no `line_code`. Attributing it to `2400.1` for TBR - FL is a convention layer above the view; the view does not know its output binds to a KPI line.
- **B-H5: no client-count / meals count on TBR-FL's 4-8% BGC and MLB add-on lines** (contract §V flat rates like the $280 Labor Fee and $15 Road Sandwiches, per `ACCOUNT_MODEL_MATRIX.md:37`). These are per-diem flats that live outside `sc_daily_revenue`'s per-meal price model. Not measured this pass.

### H.2 CIN - OH fee, per-period P1-P8 `[code-read]` `[ran]`

**Structure that does NOT work today:** the fee schedule alone cannot answer this.

Working ingredients:
- `sc_fee_schedule` row: `amount = $376,686`, `effective_date = 2026-01-01`, `payment_cadence = 'monthly-6'`. `[ran]`
- No installment table, no per-period allocation column, no start-month, no P1-P13 mapping. `[code-read docs/migrations/sc-5-fee-schedule.sql:60-105]`
- `payment_cadence` is a schema comment declared "informational only, schema does not drive any compute from this field." `[code-read docs/migrations/sc-5-fee-schedule.sql:72-75]`

**Blockers named:**

- **B-H6: no installment schedule table.** To turn `monthly-6` into `{P3: X, P4: X, ...}` you need to know that CIN - OH invoices Mar-Aug (from contract §2.a, quoted in `ACCOUNT_MODEL_MATRIX.md:32`), then map each invoice month to a period. That mapping does not exist as a table.
- **B-H7: recognition vs billing.** Playbook D1 says fees book on the P&L at 2400.1. The P&L smooths the annual fee into periods differently from the invoice cadence. Without a `pnl_actuals` source (Part G), the Overview cannot reproduce the P&L's smoothing curve. It also cannot recompute a per-period revenue figure without a specified allocation formula.
- **B-H8: no ledger of what has actually been invoiced YTD.** `sc_fee_schedule` records the contract terms; it does not track which invoices have been sent. Without a `qbo_invoice_ledger` or equivalent (nothing found under grep), the Overview cannot say "of $376,686 for the year, $Y has been invoiced through P8".
- **B-H9: escalation history.** The escalated $376,686 is in as a seed row rather than as a supersede on top of a $362,500 base. The Overview cannot render "superseded" per playbook §4.5 without joining `sc_config_changelog` for the supersede history. Not measured this pass.

**Feasibility read:** CIN - OH's per-period fee revenue is not computable from Postgres today at any level. It requires either (a) a per-installment table and a period-mapping convention, or (b) the `pnl_actuals` upload lane that Part G confirms is missing, or (c) a hardcoded allocation formula tied to `payment_cadence` values which the schema explicitly refuses to bind to compute.

---

## Completeness map (C2)

| Part | Status | Reason |
|---|---|---|
| A - §5.7 fee-account price contamination status | **DONE** | Fix confirmed not shipped; schema state measured; per-account verdict landed. |
| B - `sc_fee_schedule` live state | **DONE** | 5 rows dumped; CPI escalations confirmed on CIN-OH + STL-MO; cadence gap named. |
| C - `kpi_budgets` revenue inventory | **DONE** | 715 rows counted (11 x 5 x 13); activation checked; disagreements named (D3 / 2400.1 vs 2400.2). |
| D - SC actuals data state | **DONE** | Per-account rows / months / bursts / writers dumped; test-vs-real character stated per account. |
| E - 2300 Service Charges | **DONE** | 8 candidate tables all ABSENT; no upload lane in `src/`; Overview has no 2300 actuals source. |
| F - TXR - TX - V revenue state | **DONE** | `sc_labor_sold_revenue*` ABSENT; reader still Sheets at ops/route.js:176-188 with row-order resolve; 164 sc_homestand_schedule rows counted for TXR-V. |
| G - `pnl_actuals` | **DONE** | Table ABSENT; consequence stated. |
| H - revenue rollup dry run | **DONE** | TBR-FL structure works P1-P8 (numbers landed); CIN-OH structure blocked with 4 named blockers. |

## Acceptance echo (C4)

- **Part A** "Verdict per account: CLEAN or CONTAMINATED, with measured amounts" - `[ran]` - all five accounts CONTAMINATED, CIN-OH $4,671.76 + STL-FL $466,216.00 actively bleeding, other three latent.
- **Part B** "The cadence question: can the schedule alone produce a per-period P1-P13 fee-revenue figure?" - `[code-read]` `[ran]` - No. Named missing: start-month / installment table, per-period allocation, recognition-vs-billing distinction. `payment_cadence` explicitly declared informational.
- **Part C** "Which revenue line_codes carry FY2026 budget rows, and how many periods each. COUNTS AND PRESENCE ONLY - NO DOLLAR VALUES" - `[ran]` - all 11 accounts x all 5 lines x all 13 periods present. Three disagreements named vs docs; none resolved per brief.
- **Part D** "Real-looking, test-looking, or empty" - `[ran]` - one paragraph per account landed. STL-MO / TXR-TX-H / TXR-TX-V empty; CIN-OH real; the seven others carry a heavy 2026-06-15 seed signature with light real edits on top.
- **Part E** "State plainly what the Overview can source 2300 actuals from today" - `[ran]` `[code-read]` - Nothing. Eight candidate tables ABSENT; no upload lane in `src/`.
- **Part F** "Reader/writer today, did sc-28 ship, latest-per-homestand timestamp-ordered or row-order, count of homestand entries through P8" - `[code-read]` `[ran]` - Sheets still, sc-28 did NOT ship, still row-order (playbook N11 live), 164 rows in sc_homestand_schedule for TXR-V (full season, not filtered to homestand-only).
- **Part G** "Does `pnl_actuals` exist?" - `[ran]` - ABSENT. Overview has no P&L-actuals lookback source.
- **Part H** "One per-meal + one fee account, walk producing per-period P1-P8 revenue actual, report structure + blockers" - `[ran]` `[code-read]` - TBR-FL structure landed with P1-P8 numbers + 5 blockers named. CIN-OH structure infeasible today; 4 blockers named.

## Unmeasurable as written + blocked items (named, not worked around)

1. **CIN-OH per-period fee revenue actuals** - unmeasurable as written. Requires either `pnl_actuals` (ABSENT) or an installment ledger + period-map convention (neither exists). Named at H.2 B-H6/B-H7/B-H8.
2. **TXR-V P&L reconciliation delta -8.7%** - not attempted per brief instruction ("Do NOT attempt to solve the -8.7% P&L gap"). Named at Part F.
3. **`2300 Service Charges` actuals** - unmeasurable. No PG table, no upload lane, per Part E.
4. **2600 Consulting actuals** - unmeasurable. Line active on all 11 accounts as budget rows; no source enumerated in docs and no obvious operational-source table. Not probed further this pass.
5. **`sc_fee_schedule` escalation supersede history** - not measured this pass. Would require joining `sc_config_changelog` where `entity_type = 'fee'`. Named at B.2.
6. **TBR - FL / STL - FL add-on flat-rate revenue lines** (BGC $6.50/estimate, TBR-FL Labor Fee $280, Road Sandwiches $15) - unmeasurable from `sc_daily_revenue` alone. Named at H.1 B-H5.
7. **STL - FL Fun Money allocation service** - identified as `is_non_revenue` planned in `ACCOUNT_MODEL_MATRIX.md:71` and Part A shows the service in `sc_service_prices`, but the flag conversion has not landed. Currently reads as $25,000 projected price on 2026-01-01, $0 on 2026-06-16. Not a blocker for the Overview but worth naming.
8. **TXR-TX-V 2400.1 vs 2400.2 GL binding** - open per playbook "With Joe #4" list (`docs/KPI_DASHBOARD_PLAYBOOK.md:637`). Named at C.4 disagreement #1; not resolvable in this pass.

---

*END - written by the Master KPI CC seat, 2026-08-28.*
