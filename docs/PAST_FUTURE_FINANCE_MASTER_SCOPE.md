# Past & Future Finance - Master Scope

> **The living alignment doc for the FIN-2027 program.** This is a current-state orientation doc: it points to detail, it does not contain it. Updated at the close of every working session (Chat-Claude drafts the delta, CC commits it, Kevin merges). If this file grows past ~3 screens, something belongs in a linked doc instead.

**Program tag:** FIN-2027 (branch + PR prefix)
**Last updated:** 2026-09-17d (W1 loads landed: Stage 0 FY2026 P9 via existing loader; Stage 1 PR-A #1166 MERGED; Stage 2 PR-B #1167 DRAFT with pnl-3 + pnl-4 applied + FY2024 3,708 rows + FY2025 3,452 rows loaded; invented-zeros finding logged to `docs/backlog/pnl-actuals-invented-zeros.md`)
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
| W0 | Orientation + technical review (read-only) | **COMPLETE** - `docs/audits/FIN2027_ORIENTATION_2026-09-17.md`, PR #1163 merged | (closed) |
| W1 | FY2024-FY2025 closed P&L history + FY2026 P9 into PG (per year, per period, per account, read-only) | **LOADS COMPLETE 2026-09-17** - Stage 0 FY2026 P9 (3,167 rows, 11/11 recon PASS); Stage 1 PR-A #1166 MERGED; Stage 2 PR-B #1167 DRAFT with FY2024 3,708 rows + FY2025 3,452 rows loaded. Audit doc `docs/audits/FIN2027_W1_LOAD_2026-09-17.md`. Invented-zeros finding logged to backlog. | Kevin + Chat-Claude review PR-B; merge; then W2 can start |
| W2 | Confirm the SC 2023-2025 historical upload (separate Claude + CC session) + PR-7 (`sc_daily_revenue` view guard) | IN FLIGHT ELSEWHERE | W2's first act is PR-7 per W1 brief §5.5 |
| W3 | Dissect Joe's 2027 budget scenarios (Full MLB + No MLB bookends) | **FILES RECEIVED 2026-09-17, Chat-Claude pre-read done** | Gated on W0 report + PR-5 (scenario architecture) |
| W4 | Meeting-note-driven analysis (food $/meal, labor, P+S) + leadership review session | NOT STARTED | W1 + W3; target ~09-30. **Design constraint (2026-09-17)**: cost-per-meal metrics exclude CIN - OH, STL - MO, STL - FL from both numerator and denominator (food is pass-through billed as reimbursement; $0 on 3200.1 is correct, not missing). |

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

**Pending rulings (PR-#, decided when their gate clears):**

| ID | Question | Gate / status |
|---|---|---|
| PR-1 | Historical rows in `pnl_actuals` itself, or a separate history table? Chat-Claude leaning: same table, IF the W0 read-path audit shows every query is year-safe (or the fix list is small and lands first) - one table, one loader, the PK was built for multi-year. Separate table only if the audit says contamination risk is real. | W0 §5.5 verdict -> Kevin ratifies |
| ~~PR-2~~ | ~~FY2023: park or load?~~ | **RESOLVED -> R-10 (parked)** |
| ~~PR-3~~ | ~~FY2027 fiscal calendar~~ | **RESOLVED - Joe's 2027 workbooks: P1 = 2026-12-28, 13 x 28, P13 ends 2027-12-26; CC re-verifies row-4 dates in W0** |
| PR-4 | Non-portfolio tabs (1731, CHI, New Business, DTOR, CORP + the 2027 workbooks' CORP / Employer Taxes / Travel Budget / PFS - New Business tabs): skip for W1/W3, or load any? | Kevin (default: skip, per R-4) |
| PR-5 | Scenario architecture for FY2027. Chat-Claude rec: a separate read-only scenario layer - `scenario_catalog` (scenario_key, label, description, source file, as-of date) + `budget_scenarios` (scenario_key, account_key, fiscal_year, period_no, line_code, amount) - loaded with both bookends (`2027-full-mlb`, `2027-no-mlb`). `kpi_budgets` stays single-truth for the live board; the locked 2027 operating budget gets promoted into it later via the existing loader pattern. Bookends + per-period delta ("MLB exposure") over N speculative middle scenarios. Scenarios are append-only and versioned; Joe's revisions land as new keys, never overwrites. | Kevin ratifies (schema itself designed in the W3 brief after W0) |
| PR-6 | Partial-lockout composition rule for fixed-cost lines (3100.2 salary, 5002.x, 5004.8/9, travel): Joe changed these full-year in the No-MLB bookend, so a "lockout through period N" blend has no defined behavior on them without his rule (step-down timing, pro-rate, or hold-at-full). Needed ONLY if leadership wants composed middle scenarios before the lockout picture firms; the bookends + exposure map need nothing from Joe. | Joe, when/if composed scenarios are requested |

## 6. Findings ledger

W0 report 2026-09-17 · 13 findings F-1..F-13 in [`docs/audits/FIN2027_ORIENTATION_2026-09-17.md`](audits/FIN2027_ORIENTATION_2026-09-17.md) §2. One P0 (F-1: 8 unsafe KPI/labor SELECTs, resolved by PR-A #1166), four P1 (F-2..F-5), five P2 (F-6..F-10), three P3 (F-11..F-13). F-6 fixed in Playbook §3.6 as part of PR-B.

W1 close-out 2026-09-17 · one P0-class item: **loader writes actual = 0 on workbook cells with actual EMPTY and budget populated**, violating the pnl-1 absence contract. 2,037 rows across three years (FY2024: 1,110; FY2025: 88; FY2026 P1..P9: 839). Logged to [`docs/backlog/pnl-actuals-invented-zeros.md`](backlog/pnl-actuals-invented-zeros.md) with two fix options. Not implemented in W1 per Kevin ruling - the fix is a KPI-lane change (schema + reader audit) that cannot be made unilaterally. See [`docs/audits/FIN2027_W1_LOAD_2026-09-17.md`](audits/FIN2027_W1_LOAD_2026-09-17.md) for the finding writeup.

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
