# Past & Future Finance - Master Scope

> **The living alignment doc for the FIN-2027 program.** This is a current-state orientation doc: it points to detail, it does not contain it. Updated at the close of every working session (Chat-Claude drafts the delta, CC commits it, Kevin merges). If this file grows past ~3 screens, something belongs in a linked doc instead.

**Program tag:** FIN-2027 (branch + PR prefix)
**Last updated:** 2026-09-17q (W1-V independent load verification landed: `docs/audits/FIN2027_W1_VERIFICATION_2026-09-17.md`. Full two-way census PASS across all three years; PWZ counts match predictions exactly (1110 / 88 / 839); 20 pnl_reconciliation_exceptions anchor cross-check PASS. Loader-vs-DB fidelity confirmed by independent code paths per brief §0. Next: W2 (R-15 view guard first), then W3 scenario layer toward the ~09-30 session)
**Seats:** Kevin (owner - merges, Studio migrations, all rulings) · Chat-Claude (architect - briefs, reviews, this doc) · CC (master coder + researcher - executes, reports, never merges) · Josh Katt (sponsor) · Joe Lessard (2027 budgets, closed financials) · Sebastian Castro (finance workbooks)

---

## 0. Plain English summary

We are loading KitchFix's financial history into Postgres - closed budget-vs-actual P&Ls for FY2024 and FY2025 (FY2023 optional), the FY2026 P9 update, and historical Service Calendars for the four accounts that have them - so that 2027 budget review runs on queries against one database instead of manual spreadsheet work. The first use: stress-test Joe's 2027 site P&Ls against history and confirm contribution margins, per the 2026-09-16 leadership review.

**The one gate that matters right now:** the W0 orientation audit. Nothing loads until CC has verified, against live code and live rows, that the fiscal calendar, the loaders, and the KPI read paths can safely take multi-year data.

## 1. Goal and metrics (per the 2026-09-16 review - Josh / Joe / Kevin)

The goal is **verification, not cost reduction**: rip the 2027 site P&Ls apart, rebuild them from history, and confirm site-level contribution margins.

Metrics leadership wants answerable from the database:

- Food cost per meal - blended per site, split MLB vs MiLB, and viewable by period
- Total labor and hourly labor (they diverge when a site runs without a chef)
- Packaging + supplies
- Corporate line items are **excluded** for this pass

Scope notes: St. Louis (both sites) has essentially no history. The analysis core is the four accounts with real SC history: TBJ - FL, TBR - FL, CIN - AZ, TXR - AZ. TBR - FL is expected to show outliers - investigate them, do not smooth them.

**Clock:** Josh asked for ~2 weeks from 09-16 (target leadership review ~2026-09-30). Kevin is on site with teams part of the week of 09-21.

**The 2027 lockout wildcard:** a potential MLB lockout could keep MLB players out for anywhere from part of spring training to the entire MLB season - or not happen at all. Joe has built the two bookend budgets (Full MLB and No MLB, both dated 9/7/26); reality will likely land between them. The program treats these as named scenarios with a per-period exposure delta, not as N speculative middle cases - see PR-5/PR-6.

## 2. Workstreams

| W | Name | Status | Next / gate |
|---|---|---|---|
| W0 | Orientation + technical review (read-only) | **COMPLETE - PR #1163 MERGED 2026-09-17** (Chat-Claude review PASS: dollar scan clean, allowed paths only) | none |
| W1 | FY2024-FY2025 closed P&L history + FY2026 P9 into PG | **COMPLETE 2026-09-17 - PR #1163 (W0) and #1166 (PR-A) and #1167 (PR-B) all merged.** `pnl_actuals` now holds FY2024 3,708 + FY2025 3,452 + FY2026 P1-P9 3,167 = 10,327 rows; 20 FY2024 reconciliation exceptions recorded; `fiscal_periods` seeded FY2024-FY2027; 35 `kpi_period_status` rows verified. Findings F-14 to F-16 logged; rulings R-12 to R-21. **W1-V verification pass COMPLETE 2026-09-17q** (`docs/audits/FIN2027_W1_VERIFICATION_2026-09-17.md`): full two-way census PASS on all three years; PWZ counts match predictions exactly; 20 exception anchor cross-check PASS; 25/25 sample match. | Backlog carrying: F-16 invented-zeros doc for the KPI lane (`docs/backlog/pnl-actuals-invented-zeros.md`) |
| W2 | Confirm the SC 2024-2025 historical upload (separate Claude + CC session) | **HOLD** - zero pre-2026 rows in PG yet (good); F-3/F-5 mean any pre-2026 actuals landed today would be silently priced at 2026 rates by `sc_daily_revenue` | The other session must NOT land rows until the R-15 view guard ships (W2's first act); then reconciliation is scoped |
| W3 | Dissect Joe's 2027 budget scenarios (Full MLB + No MLB bookends) | **BRIEF READY** (`CC_BRIEF_FIN2027_W3_SCENARIO_LAYER.md`) - scn-1 schema + both bookends + PG-vs-workbook diff parity + the MLB-exposure workbook for the ~09-30 session | Launches after W1 close-out; Kevin ratifies PR-5 by pasting; two FY2027 paths in the FILES block |
| W4 | Meeting-note-driven analysis (food $/meal, labor, P+S) + leadership review session | NOT STARTED | W1 + W3; target ~09-30; every output stamps FY2026 vintage per R-17 |
| W5 | FY2026 year-end close reconciliation | SCHEDULED - ~Jan 2027, when the FY2026 P13 close file arrives | Load/verify P10-P13 per routine, then full-year 13-period Excel-vs-PG cell reconciliation before FY2026 is final for analysis (R-17). Catches any P13-close restatements at the natural checkpoint |

## 3. Data inventory

**In hand (Kevin's machine - CC receives paths in the kickoff prompt per R-11; never committed):**

- `Budget_vs_Actual__2024__P13__2_03_25__SLT__2_.xlsx` - FY2024 closed (P13)
- `Budget_vs_Actual__2025___SLT__P13__01_21_26___2_.xlsx` - FY2025 closed (P13)
- `Budget_vs_Actual__SLT___2026__P9__9_15_26_.xlsx` - FY2026 through P9
- `Budget_vs_Actual__2027__-_Full_MLB_-_9_7_26__1_.xlsx` - FY2027 budget, Full MLB scenario
- `Budget_vs_Actual__2027__-_No_MLB_-_9_7_26__1_.xlsx` - FY2027 budget, No MLB scenario
- FY2023 closed (`SLT_P13_Fins__1_14_24_.xlsx`) - **parked per R-10**, not supplied to CC
- 2026-09-16 meeting notes - Kevin-side context only per R-9; CC never reads them

**Pending:** historical service calendars from Drive (Kevin pulling; feeds W2 recon) · confirm with Joe whether a separate tracking spreadsheet is still coming or whether the `COGS per Meal` tab inside the 2027 workbooks is it · possibly QBO API closed periods (Josh's pointer - evaluate as a second source of truth, not a replacement). Sebastian's separate TXR - TX - V file is likely unnecessary - the SLT P9 workbook's TXR-VISTOR tab carries populated P1-P9 actuals (Kevin to confirm).

## 4. System state (Chat-Claude pre-read 2026-09-17 - every line pending CC verification in W0)

- `pnl_actuals` exists and fits the target shape exactly: (account, fiscal_year, period_no, line_code) with both workbook budget and actual. FY2026 loaded through P8; P9 workbook in hand.
- `kpi_budgets` FY2026 is complete and verified (34 lines x 11 accounts x 13 periods).
- The fiscal calendar is hardcoded to FY2026 everywhere (`periods.js`, `kpi_period_status` seed). No FY2023-2025 period definitions exist anywhere in the system.
- The four workbooks establish the calendar: all years 13 x 28 days, contiguous, no 53-week year (FY2023 starts 2023-01-02 ... FY2026 starts 2025-12-29; implied FY2027 start 2026-12-28 - unconfirmed, see PR-3).
- FY2024 + FY2025 tabs share the FY2026 layout with one known row-shift trap (FY2024 CIN - OH tab); FY2023 is a different layout with three retired line codes. Tab names changed every year; the REDS/CINN naming trap requires keying on row-1 titles. Full detail: W0 brief §5.9, then the orientation report §11.
- Whether historical rows can share `pnl_actuals` with FY2026 or need a history table depends on the KPI read-path audit (W0 §5.5) - undecided (PR-1); Chat-Claude leaning: same table if the read paths prove year-safe.
- The 2027 scenario workbooks (both) confirm the FY2027 calendar from Joe's own row-4 dates: P1 starts 2026-12-28, 13 x 28 days, P13 ends 2027-12-26 (resolves PR-3). All 11 account P&L tabs match the FY2026 layout exactly (same 197-column band, same 32-leaf fixed rows, zero unknown line codes).
- The 2027 workbooks also carry per-account `- Data` tabs (Joe's day-by-day 2027 meal projections with per-meal prices - effectively an Excel service calendar) and a `COGS per Meal` tab holding Joe's own historical COGS/meal and food-cost/meal analysis for the six SC-history accounts (FY2023 through P11, FY2024 through P9, FY2025 full) - the exact metrics R-3 targets; our history load can verify and complete those partial-year figures.
- Scenario diff shape (Chat-Claude pre-read, CC to verify): the two bookends differ on ~768 period-budget cells. MiLB accounts (TBJ - NY, CIN - KY) differ on travel only - MiLB plays through a lockout. MLB accounts differ P4-P10 on variable lines (revenue, hourly labor, food, packaging) plus full-year on staffing/fixed lines (3100.2, 5002.x, 5004.8/9, travel). PDC accounts differ mostly P1-P3 (spring training) plus select full-year lines. Consequence: variable lines splice cleanly by period; fixed-cost lines do NOT - a composed partial-lockout scenario needs Joe's step-down rule (PR-6).

## 5. Rulings ledger

| ID | Ruling | Source |
|---|---|---|
| R-1 | Purpose is verification of P&L accuracy + contribution margins, not cost cutting | Josh, 2026-09-16 |
| R-2 | History starts at FY2024; FY2023 optional and parked pending PR-2 | Josh + Joe, 2026-09-16 |
| R-3 | Metrics: food $/meal (blended, MLB/MiLB split, by period), total + hourly labor, packaging + supplies | Josh + Joe, 2026-09-16 |
| R-4 | Corporate line items excluded from this pass | Josh, 2026-09-16 |
| R-5 | Historical financial data in PG is for analysis only - never intranet display (KPI-page surfacing is a separate later decision) | Kevin, 2026-09-17 |
| R-6 | History loads read-only, per year per period per account, shaped for both accounting reads and future KPI use | Kevin, 2026-09-17 |
| R-7 | TXR - TX - V stays out of the KPI dashboard build until year end; its P&L actuals come from Sebastian's file | Kevin, 2026-09-17 |
| R-8 | Loader discipline extends to all FIN work: the public repo carries zero dollar literals - workbooks stay in `~/Downloads`, probes print counts/dates/PASS-FAIL only | Standing (inherited from KPI program) |
| R-9 | Meeting notes are context only and are never supplied to CC. Nothing from them beyond the financial rulings above ever enters the repo - the notes contain confidential personnel content and the repo is public | Chat-Claude flag, Kevin to ratify |
| R-10 | FY2023 is parked - out of W1 and out of every loader; the shape findings stay on record in the W0 brief for whenever it is revived | Kevin, 2026-09-17 (resolves PR-2) |
| R-11 | Workbooks are delivered to CC as file paths in the kickoff prompt (not a fixed `~/Downloads` convention); files are never committed, never copied into the repo | Kevin, 2026-09-17 |
| R-12 | History architecture: fix the eight year-unsafe KPI/labor queries first (W1 PR-A), then FY2024-FY2025 land in the SAME tables (`pnl_actuals`, `kpi_period_status`) - no `_history` twins | Kevin, 2026-09-17 (resolves PR-1) |
| R-13 | Non-portfolio tabs (1731, CHI, DTOR, CORP, Kitchfix Total, P&L Across, and everything in the FY2027 files beyond the 11 P&L tabs) are skipped. Joe's `COGS per Meal` tab is never imported - W4 recomputes those metrics from loaded data and compares against it | Kevin, 2026-09-17 (resolves PR-4) |
| R-14 | "Live" for the four SC accounts means operational (data entry live). `sc_revenue_live` flips for CIN - AZ / TXR - AZ are a separate live-board decision, parked outside FIN-2027 | Kevin, 2026-09-17 |
| R-15 | SC historical price coverage: `sc_daily_revenue` gets a NULL-outside-price-coverage guard as its own fenced view-recreate PR with a 2026 before/after parity probe; pre-2026 SC rows land only after it ships; no reconstruction of 2024-2025 per-service prices (historical revenue truth = `pnl_actuals`; historical SC value = meal counts) | Kevin, 2026-09-17 (resolves PR-7; executes at the head of W2) |
| R-16 | The P1-P8 restatement audit (8/20 vs 9/15 workbook diff) is SKIPPED. The Stage 0 re-write of P1-P8 from the 9/15 file is accepted unaudited - the finance workbook is the actuals authority, so current state = newest finance truth. Recorded so future-us knows it was a decision, not an oversight | Kevin, 2026-09-17 |
| R-17 | FY2026 handling: the finance Excel remains the AUTHORITY for 2026; PG is its verified query copy - each period load reconciles to the cent at load time. FIN-2027 workstreams make NO further FY2026 value writes; Kevin's normal per-period dashboard loads for P10-P12 continue as routine outside this program. When Sebastian's FY2026 P13 close file arrives ~Jan 2027, a FULL-YEAR 13-period Excel-vs-PG cell reconciliation runs before FY2026 is treated as final for analysis - that is W5. Every W4 output stamps its FY2026 vintage: through P9, source 9/15 workbook | Kevin, 2026-09-17 |
| R-18 | FIN-2027 changes to `src/app/kpi/**`, `src/lib/kpi/**` or `src/lib/labor/**` are production KPI work and carry KPI-grade guards: (1) symbol-removal check - grep the resulting tree for every removed or renamed identifier, zero surviving references, pasted in the PR body (a green build is NOT a reference check; a diff review structurally cannot see a survivor on an unchanged line); (2) sentinels must name the surface AND the data condition that reaches the changed code path, not just "the page loads"; (3) the PR body names the blast radius - which accounts, ranges and surfaces break if the change is wrong. Origin: PR #1166 deleted `const FY2026` in salaryBoard.js while leaving a reference in `shapeSalaryRow`, 500ing the Overview on every range with salary actuals for ~10 minutes; fixed by #1169 | Kevin, 2026-09-17 (post-incident) |
| R-19 | Closed books are never restated. Historical P&L loads mirror the workbook as it stands: where a workbook is internally inconsistent (its own per-period cells do not sum to its own year-total column), the period cells load - the table is period-keyed - and the discrepancy is RECORDED, not withheld. Reconciliation drift changes from a write-blocker to a recorded exception for FY2024/FY2025 (supersedes the sum-check-law FAIL behavior in the W1 brief §5.3 for historical years only; FY2026 period loads keep the hard gate). The check itself still runs and still reports. Condition: the exception must be queryable at analysis time, not only a line in an audit doc - a NULL in a SUM silently reads as zero, which is worse than a flagged figure | Kevin, 2026-09-17 |
| R-20 | FY2024 travel-line drift is root-caused and recorded, not fixed: the workbook's YTD-P13 actual cells are formulas of the form (YTD-P12 + P13 + a hand-typed reconciliation constant), while the per-period cells are literals carrying copied or allocated values (TBJ - FL and TBR - FL are byte-identical on 5006.1). The YTD side is the truer year total. PG holds the per-period literals (the table is period-keyed); `pnl_reconciliation_exceptions.anchor_b` preserves the workbook's reconciled year total, so the truer figure stays queryable. FY2025 is clean on all 352 leaves, so this is an FY2024 workbook-hygiene artifact, not a systemic loader or workbook problem. W4 must not quote per-site travel from per-period rows for FY2024 without consulting the exception log | Kevin + Chat-Claude, 2026-09-17 |
| R-21 | Pass-through accounts are excluded from cost-per-meal metrics on BOTH sides of the ratio. CIN - OH, STL - MO and STL - FL bill food back to the client, so they carry no food cost by design. A portfolio-blended food-per-meal that includes their meal counts with $0 cost drags the blended figure artificially low - the trap is in the denominator, not just the numerator. W4 computes food-per-meal for per-meal accounts only, states the exclusion on the face of any blended figure, and reports the pass-through accounts separately on fee-and-labor terms. When W4 compares its recomputed figures against Joe's COGS-per-Meal tab (R-13), check first how HIS blend handles these three accounts - if his includes them at zero, his benchmark carries the same distortion and that is itself a finding | Kevin, 2026-09-17 |

**Pending rulings (PR-#, decided when their gate clears):**

| ID | Question | Gate / status |
|---|---|---|
| ~~PR-1~~ | ~~Same table or `_history` twin?~~ | **RESOLVED -> R-12 (fix-first, same tables)** |
| ~~PR-2~~ | ~~FY2023: park or load?~~ | **RESOLVED -> R-10 (parked)** |
| ~~PR-3~~ | ~~FY2027 fiscal calendar~~ | **RESOLVED - Joe's 2027 workbooks: P1 = 2026-12-28, 13 x 28, P13 ends 2027-12-26; CC re-verifies row-4 dates in W0** |
| ~~PR-4~~ | ~~Non-portfolio tabs~~ | **RESOLVED -> R-13 (skip all)** |
| PR-5 | Scenario architecture for FY2027. Chat-Claude rec: a separate read-only scenario layer - `scenario_catalog` (scenario_key, label, description, source file, as-of date) + `budget_scenarios` (scenario_key, account_key, fiscal_year, period_no, line_code, amount) - loaded with both bookends (`2027-full-mlb`, `2027-no-mlb`). `kpi_budgets` stays single-truth for the live board; the locked 2027 operating budget gets promoted into it later via the existing loader pattern. Bookends + per-period delta ("MLB exposure") over N speculative middle scenarios. Scenarios are append-only and versioned; Joe's revisions land as new keys, never overwrites. | Kevin ratifies (schema itself designed in the W3 brief after W0) |
| PR-6 | Partial-lockout composition rule for fixed-cost lines (3100.2 salary, 5002.x, 5004.8/9, travel): Joe changed these full-year in the No-MLB bookend, so a "lockout through period N" blend has no defined behavior on them without his rule (step-down timing, pro-rate, or hold-at-full). Needed ONLY if leadership wants composed middle scenarios before the lockout picture firms; the bookends + exposure map need nothing from Joe. | Joe, when/if composed scenarios are requested |
| ~~PR-7~~ | ~~SC historical price coverage~~ | **RESOLVED -> R-15 (view guard; executes at head of W2)** |
| ~~PR-8~~ | ~~W1 launch ruling batch (1-5)~~ | **RESOLVED - Kevin approved all five 2026-09-17 -> R-12, R-13, R-14, R-15; P9 runs as W1 Stage 0** |

## 6. Findings ledger

Canonical ledger: W0 report §2 (F-1..F-13) at [`docs/audits/FIN2027_ORIENTATION_2026-09-17.md`](audits/FIN2027_ORIENTATION_2026-09-17.md). Headlines:

- F-1 (P0): 8 KPI/labor SELECTs not year-safe (5 hardcoded 2026, 3 no predicate) - the PR-1 gate; fixed by W1 PR-A
- F-3 + F-5 (P1): `sc_daily_revenue` silently prices out-of-coverage dates at the newest 2026 price, and zero pre-2026 price rows exist - the reason W2 is on HOLD (PR-7)
- F-4 (P1): 1,206 `labor_actuals` rows with `period_no` NULL - known class, multi-year fix must also assign `fiscal_year`
- F-6 (P2): REDS(AZ)/CINN(OH) tab trap undocumented in Playbook §3.6 - doc fix rides W1 PR-B
- F-10 (P2): FY2024 `PFS - CINN` row-shift confirmed - label-driven history loader mandatory
- F-13 (P3): contract paperwork gaps (TBJ - NY no executed 2025+ SOW; TBR - FL 2025/2026 SOWs missing; CIN - AZ / TXR - AZ 2026 SOWs missing) - carries into 2027 certification; Josh's in-flight contract work (09-16 meeting) may close some - track in W4
- F-14 (P3, backlog, NOT FIN-2027's to fix): Supabase project default privileges grant every new public table REFERENCES + TRIGGER to `anon` and `authenticated`, and REFERENCES + TRIGGER + TRUNCATE to `service_role`, on top of whatever the migration grants. Audited 2026-09-17 across pnl_actuals, kpi_budgets, kpi_period_status, fiscal_periods, pnl_reconciliation_exceptions. **No SELECT for anon/authenticated on any of them - no data exposure.** REFERENCES/TRIGGER are inert for PostgREST roles (no DDL path). The live item is TRUNCATE on service_role: the service key can wipe any of these tables in one statement. Revoked on pnl_reconciliation_exceptions (FIN-2027's own table, where the migration claims append-only). The other four belong to the KPI lane - sweep there, not here, per R-18 lane discipline
- F-15 (CLOSED 2026-09-17 by Kevin): NOT a gap. Food is a pass-through at CIN - OH, STL - MO and STL - FL - the cost is billed back to the client as a reimbursement, so those accounts technically carry no food cost. The workbook's $0 on `3200.1` is correct, `pnl_actuals` is correct, and the `1374.x` / `1385.x` codes are absent from these tabs because reimbursable revenue and cost never hit the fee P&L. Nothing to source, nothing to extend. Supersedes the earlier reading that these accounts were missing data
- F-16 (P1, affects LIVE FY2026 data): where a workbook cell has a populated budget but a BLANK actual, both `load_pnl_history.mjs` and the live `derive_pnl_actuals.mjs` write `actual = 0`, because `pnl_actuals.actual` is NOT NULL. pnl-1's own binding contract says absence means NOT REPORTED and never $0, so the loaders store a zero the workbook never claimed, indistinguishable from a real zero. FY2025 census: 88 such cells of 4,576 - including all 24 lines of CIN - KY P13 (a whole period reported as zero across the account) and 38 CIN - OH cells on revenue lines 2200/2300 across most of the season. FY2024 and FY2026 not yet censused; FY2026 is live on the KPI board. Not fixed in W1: the fix requires either dropping the budget value or making `actual` nullable on a live table, which is a design decision and a KPI-lane change, not a deadline patch. Census first, fix after the leadership session

## 7. Standing gates (binding on every FIN-2027 session)

- Recon before action; Kevin approves every plan before CC writes anything beyond reports and probes.
- Migrations: Chat-Claude reviews the SQL, Kevin applies in Studio, verify probe passes, then dependent code ships. Migration-gated PRs open as DRAFT.
- CC never merges, never self-certifies runtime outcomes; every push line lands verbatim in its report.
- Sum-check law: any per-period vector must sum to its stated total before it is used.
- Bidirectional-diff law: any DB-vs-workbook reconciliation walks both directions.
- No dollar literals in the repo (R-8). No personnel content from meeting notes in the repo (R-9).
- Hyphens not em-dashes; no emojis in artifacts; plain-English summary leads every report.

## 8. Pointers

- W0 brief: `CC_BRIEF_FIN2027_W0_ORIENTATION.md` (Kevin's machine; not committed)
- W0 report (once landed): [`docs/audits/FIN2027_ORIENTATION_2026-09-17.md`](audits/FIN2027_ORIENTATION_2026-09-17.md)
- Loader + P&L shape authority: [`scripts/derive_pnl_actuals.mjs`](../scripts/derive_pnl_actuals.mjs) header · [`docs/migrations/pnl-1-actuals-and-status.sql`](migrations/pnl-1-actuals-and-status.sql)
- KPI system authorities: [`docs/KPI_MASTER_SCOPE.md`](KPI_MASTER_SCOPE.md) · [`docs/KPI_DASHBOARD_PLAYBOOK.md`](KPI_DASHBOARD_PLAYBOOK.md)
- SC money authority: [`docs/SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md)
- Contract authorities: [`docs/pricing-summit/`](pricing-summit/) · [`docs/SC_CONTRACT_BILLING_SUMMARY.md`](SC_CONTRACT_BILLING_SUMMARY.md)

## 9. Doc maintenance

Chat-Claude drafts the update at the close of every FIN-2027 session (workstream statuses, new rulings, findings pointers, Last updated). CC commits it in that session's PR. Kevin merges. History lives in the PR trail - do not re-fill it here.
