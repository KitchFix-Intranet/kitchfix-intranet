# KPI Dashboard Playbook

**Status:** Living document. Chat-Claude maintains; CC commits each revision.
**Version:** v0.6, 2026-08-04
**Substrate:** `KPI_FOUNDATION_AUDIT.md`, `TXRV_ALIGNMENT.md`, `KPI_ROUND3_FINDINGS.md`, `RIPPLING_DISCOVERY.md` (all with corrections applied), Chat-Claude's primary-source extraction of the 2026 P&L workbooks, live repo.

Companion: `KPI_ENGINE_ARCHITECTURE.md` v1.1 (the how). This document is the what and why.

---

## 1. Purpose and the non-negotiables

### 1.1 The rule everything derives from

Kevin: *"You don't mess with people's money."*

**An operator must never trust a number here, run their business on it, and receive a materially different number at close.** Silent is recoverable. Confidently wrong is not.

Two prior attempts (2025, 2026) died on hand-entered lagging data. The surviving `/financial` proxy still hero-titles "KPI Dashboard," runs on Labor Sheets, and dies with Labor at year-end.

### 1.2 The non-negotiables

A build that violates one is a bounce.

**N1.** Pre-close and post-close never share a visual register.
**N2.** Missing, failed, and zero render distinctly. A cell showing an unreported fetch as `$0` lies.
**N3.** Every tracker screen carries a visible state legend.
**N4.** No computed confidence. Show observed facts; let the operator judge.
**N5.** Unattributed money goes to a visible bucket. `$8,000 unattributed` beats a clean number that is $8k light.
**N6.** The P&L ledger is append-only. Restatements stay visible.
**N7.** The salary line is stripped at the data layer, not render-hidden - and totals must not permit recovery by subtraction.
**N8.** Load-bearing paths get a real test before automation.
**N9.** No money tile reads a source with a known expiry date.
**N10.** A number no operator controls is not a KPI.
**N11.** Latest-wins reads never depend on row order. Every append-with-revision source resolves by timestamp, explicitly.

### 1.3 Scope of v1

**In:** period and YTD views, budget vs actual, P&L download, reconciled-period lookback, live revenue trending, live food and packaging trending with disclosed gaps, live labor once Rippling lands.

**Out:** weekly flash reports (D16), period-end projection from PTD, the 2025-2026 Cycle Review / WOW / Scorecard tabs, per-user customization, SG&A tiles beyond the summary line, **CORP entirely** (D17).

---

## 2. Canonical account model

**`accounts.team_key` (spaced-hyphen) is canonical.** Eleven client accounts. CORP is excluded.

| P&L tab | Canonical | `gl_codes` |
|---|---|---|
| CIN-AZ | `CIN - AZ` | `CIN - AZ` |
| CIN-KY | `CIN - KY` | `CIN - KY` |
| CIN-OH | `CIN - OH` | `CIN - OH` |
| STL-FL | `STL - FL` | `STL - FL` |
| STL-MO | `STL - MO` | `STL - MO` |
| TBJ-BUF | `TBJ - NY` | fixed in kpi-1 |
| TBJ-FL | `TBJ - FL` | `TBJ - FL` |
| TBR-FL | `TBR - FL` | `TBR - FL` |
| TXR-AZ | `TXR - AZ` | `TXR - AZ` |
| TXR-HOME | `TXR - TX - H` | `TXR - TX - H` |
| TXR-VISTOR *(sic)* | `TXR - TX - V` | `TXR - TX - V` |

`accounts.pnl_tab_name` carries the workbook tab name, including the `TXR-VISTOR` misspelling, which is load-bearing for the ETL.

### 2.1 Arlington

**H and V are separate accounts completely** (D11). No shared cost, no allocation rule. Each buys its own food, packaging, and supplies and codes them at scan time; each carries its own labor budget.

**Rippling separates them via department and work location - not job code.** Work locations: `"Arlington, TX (TXR-HOME)"` and `"Arlington, TX Visitor (TXR-VISITOR)"`. Departments: `"Hourly Kitchen - 3100.1 - TXR - Home Side"` and `"Hourly Kitchen - 3100.1 - TXR- Visiting Side"`, both under a shared `"Arlington TXR"` parent.

**Open operational question, not technical:** do chefs actually clock out of one department and into the other when they cross the split? The API records it; whether the humans do it is workflow discipline. **Confirm with Grant Lawson and Jordan Rodgers before trusting TXR-V's labor line.** If they do not, V's labor will be wrong and nothing in the data will say so.

---

## 3. Chart of accounts

### 3.1 Authority

**The 2026 P&L workbooks.** Not `gl_codes` (which answers "what can an operator code an invoice to," disagrees on four lines, and is 100% `is_historical`). `PL_2026_APPENDIX.md` is **demoted from citable-source status** - it is a partial transcription of one of two disagreeing sources with no note saying which.

### 3.2 The canonical lines

34 lines, live in `kpi_lines`.

**Revenue:** `2200`, `2300`, `2400.1`, `2400.2`, `2600`.
**COGS:** `3100.1`, `3100.2`, `3200.1`, `3200.2`, `3400.1`, `3400.2`, `3400.5`, `3500.1`, `3500.2`, `3500.3`, `3500.4`, `3500.5`.
**SG&A:** `5002.1`, `5002.5`, `5004.8`, `5004.9`, `5006.1`, `5006.3`, `5012.1`, `5012.2`, `5012.3`, `5012.5`, `5013.1`, `5013.2`, `5016.6`, `5016.7`, `5017.3`, `5017.5`, `5017.7`.

### 3.3 Activation rule

**A line is applicable to an account if the row exists on that account's P&L tab, regardless of budget value.** A $0 budget is a budget fact, not an applicability fact.

`5016.6` is budgeted $0 on all eleven accounts yet CIN-AZ shows real card spend in six of seven periods. `3200.1` is $0 at CIN-OH, STL-FL, and STL-MO because food routes through reimbursables codes. Marking those `not-applicable` would render `n/a` while real money flows through the line.

**FY2026: 374 rows, 350 active, 24 inactive.**

| line_code | inactive for | count |
|---|---|---|
| `3500.1` | all except TBR-FL | 10 |
| `3500.2` | TBR-FL only | 1 |
| `5012.3` | CIN-AZ, TXR-TX-H | 2 |
| `5012.5` | all except CIN-AZ, TXR-TX-H | 9 |
| `3100.1` | CIN-KY, TBJ-NY | 2 |

Activation is fiscal-year keyed. A change in circumstance is a row for the next year, not a deploy.

### 3.4 Definitions (owner-supplied)

| Line | Definition |
|---|---|
| `2600 Consulting` | One-off consulting fees to teams |
| `3500.1 Delivery Mileage` | Reimbursement when someone uses a personal vehicle. TBR-FL does delivery and sometimes sends a personal car |
| `5006.3 Account Management Travel` | Travel by the account management team to visit clients. Distinct from `5006.1` |
| `5012.2 Scavenger` | Trash collection |
| `5012.3 General Utilities` | Gas and electric where the account is not in a client-paid facility |
| `5012.5 Computer Hardware` | Company computers purchased for managers |
| `5013.1 Equipment Lease` | Leased kitchen equipment - dishwashers, ice machines |
| `5013.2 Building Lease` | Rent where the kitchen is not client-owned |

### 3.5 `3200.2 Resale Food` - three meanings, one code

**Base allocation is 4% of the general food budget**, an inflation savings account. Sites hit budget on general food, then this absorbs overage or funds additional client offerings. **Fun money** - budget KitchFix spends on extra client service days - rides in the same line at two accounts.

| Account | General food | Resale | Composition |
|---|---|---|---|
| CIN-AZ | 417,251 | 16,692 | 4.0% inflation |
| TBR-FL | 511,940 | 20,478 | 4.0% inflation |
| TXR-AZ | 420,804 | 16,831 | 4.0% inflation |
| TXR-HOME | 251,975 | 10,078 | 4.0% inflation |
| TXR-VISTOR | 98,280 | 3,931 | 4.0% inflation |
| TBJ-FL | 398,408 | 28,474 | 4% inflation **+ fun money** |
| STL-FL | 0 | 24,999 | **fun money only** |
| STL-MO | 0 | 0 | code used for **Supplies** |

### 3.6 The naming trap

`2400.1 (Home)` and `2400.2 (Away)` are **chef-centric, not team-centric.** "Home" means revenue at the home stadium from the operating clubhouse's perspective. TXR-V earns at Globe Life Field for visiting clubs, hence `2400.2`.

### 3.7 Same-code collisions

STL-MO `3200.2` = Supplies · STL-FL `3200.1` = Resale Food · STL-MO `3200.3` = Linen · TXR-AZ `3200.1.1` / `3200.1.2` sub-codes. Plus the reimbursables reroute (§5.2). `code_remap (account_key, source_code, pnl_line)` is a hard prerequisite for any cost rollup.

---

## 4. Revenue model

### 4.1 Four archetypes

**Per-meal** (CIN-AZ, CIN-KY, TBJ-FL, TBJ-NY, TBR-FL, TXR-AZ) - `sc_daily_revenue`, reconciles 3-9%.
**Flat fee** (CIN-OH, STL-FL, STL-MO, TXR-TX-H) - `sc_fee_schedule`, contract cadence.
**Direct sales** (TXR-V) - §4.6.
**Hybrid** - four per-meal accounts also carry a Service Charge.

### 4.2 Rulings

**D1 - Service Fees book where the P&L books them** (`2400.1` for flat-fee accounts). `SC_MONEY_MODEL.md` is the doc that changes.

**D4 - Fee accounts show no variance.** Render fee, cadence, installment progress, label "contractually fixed." Suppress the percentage - a permanent 0.0% reads as a broken dashboard.

**D19 - CIN-AZ's $445,716 Service Fee stays out of Postgres.** Percentage-based SF accounts compute billing from per-meal actuals at post-discount rates; the annual fee is out-of-band by design. The 30% buydown **is** captured in `sc_service_prices` at 70%-of-full rates. Same for TBJ-FL and TXR-AZ.

**D20 - TBJ-NY rates are owner-confirmed.** Buffalo is a sub-scope of the Dec 2018 Toronto MSA. The $27.34 rate has four-way corroboration. Governing records `REC-107.mdx`, `REF-141.mdx`.

**D21 - the current `Budget_vs_Actual` shape is the ingest contract.** Parser codes against the 14-column period block starting at column Q. Do not redesign until the dashboard can generate the P&L itself.

### 4.3 Per-account readiness

| Account | Source | State |
|---|---|---|
| CIN - AZ | `sc_daily_revenue` + fee upload | PARTIAL |
| CIN - KY | `sc_daily_revenue` | PARTIAL - no invoices ever |
| CIN - OH | `sc_fee_schedule` | READY |
| STL - FL | `sc_fee_schedule` | READY (annual) |
| STL - MO | `sc_fee_schedule` | READY (annual) |
| TBJ - FL | `sc_daily_revenue` | PARTIAL |
| TBJ - NY | `sc_daily_revenue` | READY |
| TBR - FL | `sc_daily_revenue` | PARTIAL - reconciles 2.7% |
| TXR - AZ | `sc_daily_revenue` | PARTIAL |
| TXR - TX - H | `sc_fee_schedule` | READY (annual) |
| TXR - TX - V | `labor_sold_revenue` (Sheets) | PARTIAL - §4.6 |

### 4.4 Service Charges - the ~$2.4M band

`2300` is in no PG table by design. `PFS Service Fees 2026.xlsx` is the source across five accounts. **D8: upload monthly via the append-only path.** v1 does not attempt `2300` in the first tile.

### 4.5 Budget authority is layered

The P&L upload is the **baseline**, not always the freshest truth. Owner-ruled corrections land out-of-band - TXR-H's $40,000 hourly-to-salary move is the worked example.

**Resolution order:** a live row in a supersede-tracked table (`sc_labor_budgets`, `sc_fee_schedule`, `sc_service_prices`) wins; the uploaded P&L supplies everything else.

**Where the two disagree, the dashboard shows the live value and marks the line superseded**, with the P&L figure and reason on drill. Silently preferring one is how a chef ends up scheduling against a number nobody told him changed.

### 4.6 TXR-V - direct sales

**The business.** Chef-owned direct sales per the `Texas Catering System` SOP. Initial contact 4 weeks pre-series, follow-up at 2 weeks, menu finalized, **billing to Sebastian at order confirmation**, BEOs to Mason, satisfaction survey post-series. Britt and Kevin cc'd for visibility.

Standard printed menu. Buffets $30-$50/person, flat stations $400-$1,000, MTO grill $1,000/day. ACH at no fee or card at **+4%**. **Net 30.** ~24-25 addressable series of 26. **Direct-bill from KitchFix AR to each club's AP contact** - not through the Rangers.

**Recognition (D12): revenue is recognized when served.** Note the timing split - billing goes out at order confirmation, service happens later, recognition follows service. The dashboard must not treat invoice date as revenue date.

**Rain-outs** are case by case. **Postseason** bills separately per service and is not in the $312,000.

**Source: `labor_sold_revenue` tab in `Intranet Master Data Collection 4.0`.** Chef-written per homestand, append-with-revision. **D9: stays on Google Sheets for 2026** - the sanctioned exception, because TXR-V sales logic changes in 2027. Storage moves to Postgres now (§9.5); consumer logic does not get rebuilt.

Reconciliation, latest-per-homestand on the `sc_homestand_schedule` period map:

| Period | Sold revenue |
|---|---|
| P4 | $28,758 |
| P5 | $44,718 |
| P6 | $51,734 |
| P7 | $79,068 |
| **Through P7** | **$204,278** |
| P&L YTD-P7 actual | $223,857 |
| Gap | **-$19,579 (-8.7%)** |

Unexplained; needs a cause before this feeds a tile. Candidates: tax treatment, the 4% card surcharge, revisions after the 7/22 cut.

**A naive `SUM(SoldRevenue)` returns $483,179 against a true $229,500 - 111% overstated.** See N11.

**Labor is a dependent variable.** `labor_ratio = 0.1923` is V's labor budget as a percentage of V's own sold revenue. `sc_labor_budgets` ties exactly: hourly $60,001, forecast $312,000, ratio 0.192311. **Per-period budgets are back-solved from a constant ratio.** Variance shows against the **adjusted envelope, never the original budget**.

**The tile is a funnel:** quoted, booked, delivered, invoiced, collected - dollars at each stage, series-level detail, conversion against ~24-25 addressable series, AR aging, annual budget vs booked YTD as the closer.

**2027 exposure:** chef-hour reduction and a new billing model TBD. Do not over-build TXR-V-specific machinery.

### 4.7 TXR-HOME is the portfolio's thinnest account, and the number is real

| | Budget | YTD-P7 |
|---|---|---|
| Revenue | $604,019 | $363,316 (+6.1%) |
| COGS | $532,348 | $347,249 (+16.0%) |
| Gross margin | 11.9% | **4.4%** |
| Contribution margin | 2.2% ($13,326/yr) | - |

Next lowest budgeted CM is TBJ-BUF at 29.7%. **This is the account where a data defect is most consequential** - at 2.2% contribution, an error of a few thousand dollars flips it between profit and loss on screen. N2 applies here first.

---

## 5. Cost model

### 5.1 The headline

**Zero of 132 (account x COGS line) cells qualified as READY** at audit. Labor moves to READY when PR 8 lands.

### 5.2 The reimbursables reroute

CIN-OH books nothing to `3200.1` - all food routes through `1374.1` Reimbursables, rolling to $162,362 against a P&L COGS of $114,665 (141%), because reimbursables are billed-through and net against revenue elsewhere. STL-FL uses `1385.3`, STL-MO `1385.1`. **Same-code rollup is structurally impossible on the flat-fee accounts.**

### 5.3 Coverage and lag

`invoice_submissions` covers 10-15% of P&L COGS. Pipeline began April/May 2026, so P1-P4 are thin. CIN-KY and TBJ-NY have zero invoices ever.

Submit lag p50/p90 days: TXR-AZ 1/2 · TXR-TX-V 0/3 · TBR-FL 2/7 · CIN-AZ 2/11 · STL-MO 2/15 · STL-FL 3/18 · CIN-OH 4/16 · TBJ-FL 5/9 · TXR-TX-H 9/17. 57% within 3 days, 81% within 7.

Mid-period cost is **under-reported, not blank.** Show lag as observed fact (N4).

### 5.4 Labor budget drift - TXR-HOME only

| Account | PG hourly | P&L `3100.1` | Gap |
|---|---|---|---|
| CIN - OH | 110,000 | 110,000 | 0 |
| STL - MO | 120,000 | 120,000 | 0 |
| TXR - TX - V | 60,001 | 60,001 | 0 |
| **TXR - TX - H** | **110,000** | **150,000** | **-40,000** |

**Ruled: $110,000 is authoritative.** Roughly $40,000 moved from hourly to salary after the budget was written. The move is internal to the 3100 group and preserves the total exactly:

| | Hourly | Salary | Total 3100 |
|---|---|---|---|
| P&L as written | 150,000 | 87,386 | **237,386** |
| After the move | 110,000 | 127,386 | **237,386** |

COGS, gross margin, and contribution margin are unaffected. Since the bonus target is Total COGS (D15b), Grant's bonus math is unaffected too. What is wrong is the split - on the surface he schedules against.

**Two corrections follow:** the P&L `3100.2` should read $127,386; `sc_labor_budgets.salary_budget` is NULL in 30 of 30 rows and the corrected figures belong there on the supersede trail.

### 5.5 Labor cost source

**Rippling gives a pre-computed cost, not a derivation.** The `time_entry_computed_pay_segment` custom object carries `estimated_amount`, `estimated_hourly_rate`, `segment_duration_hours`, and `overtime_multiplier`, computed by Rippling per segment.

There is no pay-run endpoint on the REST API, so `hours x rate` was the fallback - and it would have drifted systematically on overtime premiums, shift differentials, and retro adjustments. **Reading Rippling's own computation makes the number tie by construction.**

### 5.6 Zero-budget spend is a data-source gap

CIN-AZ `5006.1` and `5016.6` show spend in 5 of 7 and 6 of 7 periods against $0 budget - and $0.00 in `invoice_submissions`. Card or ACH, never touches the scanner. Upload-only until D7 reopens.

### 5.7 P0 - phantom revenue on fee accounts

**`sc_daily_revenue` returns $149,496 of projected revenue for TXR-V**, whose prices are $0 by design. `sc_service_prices` holds two `projected` rows per service - an import seed at $25.95422 effective 2026-01-01 and the $0 overlay effective 2026-06-16. The view effective-dates correctly and prices everything before June 16 at $25.95. **The view is right; the input is wrong.**

**Likely not TXR-V-only.** CIN-OH reports `actual_revenue` of $4,671.76 YTD-P7 despite $0 prices.

**Not operator-reachable.** The export gate holds - `buildSummarySheet:588` routes fee accounts to `buildFeeServiceBlock`, and all five shared blocks gate on `withDollars = shape === "per-meal"` with money assignment inside the guard. Fix lands at PR 5, before the revenue adapters read the view.

---

## 6. Cell states

| State | Trigger | Render |
|---|---|---|
| `measured` | a source reported a value, including a real zero | the value; `$0` carries a measured affordance |
| `not-applicable` | account carries no budget row for this line | `n/a` pill, excluded from totals and completeness denominators |
| `not-reported` | period open, or period end inside the lag window, or first data postdates the period | explicit pending, never `$0` |

Distinguishable in grayscale at 1024-1536. On the standing sweep battery.

### 6.4 Unapproved labor is not a badge, it is a different number

Rippling stamps every time entry `DRAFT` / `APPROVED` / `PAID` / `FINALIZED`.

**The risk is not that unapproved hours look unapproved. It is that they look low.** A chef leaves a shift unpunched, the dashboard reads $4,000 against a true $4,600, and they conclude they are on budget.

```
Labor to date    $18,240
                 $2,110 of this is unapproved (3 entries)
                 Last approved through Jan 18
```

**Show entry count alongside dollars.** Three unapproved entries at normal shift length is routine. Three totalling $80 means a punch never closed. The shape is the tell.

**Show "approved through" as a date, not a percentage.** Actionable rather than decorative.

**Open for the PR 8 design pass:** does an unapproved period suppress the variance figure, or render it with a caveat? Leaning toward rendering with the caveat - withholding sends operators back to the spreadsheet.

---

## 7. Variance display

| Case | Render |
|---|---|
| budget 0, actual 0 | suppressed |
| budget 0, actual > 0 | `unbudgeted +$X`, no percentage |
| budget > 0, actual 0, `measured` | `-100%` |
| budget > 0, actual 0, `not-reported` | pending, no variance computed |
| both non-zero | percentage, capped at +/-100% with a clipped indicator |
| fee-account revenue | none (D4) |
| TXR-V labor | against **adjusted envelope**, never original budget |

Every line carries a `data_source` marker: `invoice`, `payroll`, `card`, `service_calendar`, `fee_schedule`, `pnl_upload`, `sold_revenue`, `manual`.

---

## 8. Access control

### 8.1 The model

Every salaried manager is bonus eligible on hitting their COGS budget (D15). **The target is Total COGS - labor, salary, food, packaging, vehicle** (D15b). RDOs see every account (D6).

| Role | P&L for | Total COGS | Group totals | `3100.1` / `3100.2` split |
|---|---|---|---|---|
| Kevin, Josh, Joe | all | yes | yes | yes |
| Corporate Finance | all | yes | yes | yes |
| RDO | all sites | yes | yes | yes |
| Site Leader | their account | yes | yes | yes |
| Sous / Hospitality Manager | their account | yes | yes | **no** |

**No salary above site-leader level is accessible to anyone outside Kevin, Josh, and Joe.** Corporate and SLT compensation is out of scope entirely - not filtered, **absent**.

### 8.2 The subtraction problem, and how grain solves it

```
Total COGS = 3100.1 + 3100.2 + 3200.x + 3400.x + 3500.x
```

Show a sous Total COGS plus every component including hourly, and salary falls out by subtraction. Worked on TXR-HOME: `237,386 - 150,000 = 87,386`.

**The fix is grain, not concealment.** Present COGS at the **group** level:

| Line | TXR-HOME |
|---|---|
| Total 3100 Kitchen Labor | 237,386 |
| Total 3200 Food | 262,053 |
| Total 3400 Packaging & Supplies | 31,159 |
| Total 3500 Vehicle | 1,750 |
| **Total COGS** | **532,348** |

Four groups sum exactly. Salary is not derivable because hourly is never separated from it.

**The trade:** a sous loses the hourly line *on this surface*. They keep it in the Service Calendar and labor tool, where salary never appears. Different surface, different grain, no leak in either.

**Do not build a `3100.1`-visible view for sous under any framing.**

**Small teams leak by headcount.** Where an account has one salaried manager besides the site leader, "Total Salary Wages minus my own" is that person's pay. **Any account with two or fewer salaried staff has this problem.** Needs a suppression rule below a headcount threshold - specify during the PR 7 design pass.

**No production leak exists today.** There is no in-intranet P&L distribution path, and the externally-produced P&L **recalculates its totals** when the salary row is removed.

**One payload leak:** `/api/ops` `labor-bootstrap` returns `crossAccount[].salaryBudget` to every caller regardless of admin status. Not rendered, but visible in DevTools. ~7 lines. Item 0b.

### 8.3 The bonus target is defined but not published

**Total COGS** (D15b). No OPD or policy document says so. Before v1 renders a bonus-facing tile, the definition needs a published doc so the number carries authority rather than resting on a chat ruling.

### 8.4 Build

Populate `users`; `gl_codes.visibility_tier`; one `visibleGlCodes(user, accountKey)` helper wired into the API read path **and** any export builder. Downloads carry `Generated for <email> on <date>`. Distribute-to-team builds one file per recipient.

**The blocker is that no identity model exists.** `users` is empty, `contacts.role` is free text, no account-to-role mapping. **10-21 days**, and it gates any surface rendering `3100.2`. **Deserves its own spec before PR 7 starts.**

---

## 9. Pipeline inventory

### 9.1 By band

| Band | Source | State |
|---|---|---|
| Per-meal revenue | `sc_daily_revenue` | LIVE, reconciles 3-9% |
| Fee revenue | `sc_fee_schedule` | LIVE annual; view contaminated, §5.7 |
| Service charges | `PFS Service Fees 2026.xlsx` | out-of-band by design; upload (D8) |
| TXR-V direct sales | `labor_sold_revenue` (Sheets) | LIVE; storage migrating (§9.5) |
| Food / packaging | `invoice_submissions.gl_breakdown` | PARTIAL 10-15%, needs remap |
| Hourly + salary labor | Rippling | PR 8 |
| Card / ACH | none | upload-only (D7) |
| P&L actuals | none | PR 2 upload |

### 9.2 The legacy labor loop is on Google Sheets

`HUB.labor_budgets` holds envelope and forecast; `COLLECTION.labor_sold_revenue` and `COLLECTION.labor_plans` take chef writes. **`accounts.labor_ratio` exists in PG but the live runtime does not read it.**

Unmitigated drift between `HUB.labor_budgets` and `sc_labor_budgets` - already realised as the TXR-H $40k gap. And a known expiry: Labor dies with Sheets at year-end. **N9: no KPI money tile ships against this source.**

### 9.3 Rippling

**Retrieval is by cursor walk, not date filter.** Every date, worker, and sort parameter on `/time-entries` is silently ignored; only `limit` and the cursor are honoured. The cursor field is `next_link` in the response body, not any standard name. `order_by=start_time` returns 400.

Observed: 2,300 entries across 2025-11-03 to 2026-02-22, 130 workers, 90 service dates. **That window is the baseball off-season and understates in-season volume - treat any extrapolation as a floor.** A realistic full backfill is 15,000-20,000 rows across 150-200 pages.

**Data floor is 2025-11-03.** Fiscal P1 2026 opens 2025-12-29, so the full fiscal year is reachable with ~8 weeks to spare.

**The backfill cannot run as a Vercel cron** - it is a one-time script run locally. The nightly incremental is a cron: cursor-walk, **re-walking a recent overlap window and deduplicating** rather than trusting a saved cursor, since payroll mutates backward.

**Two-layer landing.** `rippling_raw_*` immutable with fetch metadata, plus derived tables. Payroll mutates retroactively; re-derive from raw rather than re-pull.

**Retro signal is event-based.** `updated_at` per entry plus `time_entry_edit_history_zo` carrying `change_type`, `edit_source`, editor, `old_value` / `new_value`, and clock IPs.

**Compensation returns raw pay unredacted.** `annual_compensation.value` came through directly. `__meta.redacted_fields` does fire - `country_fields` is redacted on worker records - so the mechanism works; compensation is simply in scope. **The API token reads every salary in the company. Treat it as a database credential.**

### 9.4 Append-with-revision sources depend on row order

`src/app/api/ops/route.js:176-186` builds `soldRevenueMap[hsId]` by plain assignment in a loop. **Last-write-wins by row order, no sort on Timestamp.** The writer records a Timestamp the reader ignores. Correct today only because Sheets appends to the bottom. **`labor_plans` has the same trap.** N11 exists because of this.

### 9.5 `sc-28` - sold revenue to Postgres

One writer (`submit-sold-revenue`), one reader (`labor-bootstrap`), one UI component. ~120-180 LOC, one migration, LOW risk, chef UI untouched.

```sql
sc_labor_sold_revenue (id, account_key, homestand_id, sold_revenue, entered_by, entered_at)
CREATE VIEW sc_labor_sold_revenue_latest AS
  SELECT DISTINCT ON (account_key, homestand_id) ...
  ORDER BY account_key, homestand_id, entered_at DESC;
```

**Worth doing despite the 2027 change** - it edits the *consumer* of `soldRevenue`, not the storage.

### 9.6 Rippling attribution - department is the key

**A labor dollar resolves to an account through `worker.department_id`.** Leaf department names carry both dimensions:

```
Hourly Kitchen - 3100.1 - REDS OH
Salary Wages   - 3100.2 - TXR- Visiting Side
```

One lookup gives account attribution **and** the `3100.1` / `3100.2` split.

**Job codes are NOT the key.** They are role names - 13 of them, the sampled one is `Cook`. Zero account keys matched. `job_codes_id` is empty on every sampled time entry.

**Key on `department_id`, never the name string.** Names are free text in a system we do not control - `"TXR- Visiting Side"` already carries a typo. Parse once to build the map, seed a table keyed on the stable UUID, never parse again.

**Work location is many-to-one and cannot be the key.** TBR-FL has two clock-in locations - Port Charlotte (kitchen) and Englewood (stadium) - both landing on `TBR - FL`. Work location remains a **cross-check**; surface every disagreement.

**Unmapped departments go to a visible bucket** (N5). A probe alerts when a new `department_id` appears.

**The map requires Kevin's row-by-row sign-off before PR 8b builds against it.** A department mapping to nothing fails loudly and is safe. A department mapping to the wrong account produces a plausible number on the wrong P&L.

### 9.7 Department to account map

| Department name contains | Account |
|---|---|
| REDS OH | `CIN - OH` |
| Goodyear / AZ | `CIN - AZ` |
| Louisville / KY | `CIN - KY` |
| Cardinals - Jupiter | `STL - FL` |
| Cardinals - St. Louis | `STL - MO` |
| Dunedin | `TBJ - FL` |
| BUF | `TBJ - NY` |
| Port Charlotte **or** Englewood | `TBR - FL` |
| Surprise | `TXR - AZ` |
| TXR - Home Side | `TXR - TX - H` |
| TXR- Visiting Side *(sic)* | `TXR - TX - V` |
| CORP | out of scope |

**"Cardinals" is two departments, not one.** Jupiter at $1.4M and St. Louis at $489k. Both parse to the same word; **they must be distinguished by `department_id`.**

**`TBJ - BUF` divergence, third occurrence.** Normalise at Rippling ETL using the same helper as the `gl_codes` fix - one shared normaliser, not three.

### 9.8 CIN-KY and TBJ-NY are salaried single-employee accounts

**Both accounts are one person, salaried, no hourly staff.** This explains a cluster of findings previously logged as possible data problems, all of which were correct as recorded: `3100.1` budgeted $0, hourly actuals blank P5-P7, a salary department with no hourly counterpart, no Buffalo schedule, zero invoices.

**Rendering rule: `3100.1` resolves `not-applicable`.** Not `$0`, not `not-reported`.

**This is data, not code.** `kpi_line_activation` is fiscal-year keyed.

### 9.9 Manual refresh

**An admin-triggered refresh for a given account and period.** Driving case: mid-review, the dashboard flags unapproved hours, the chef approves in Rippling, refresh, look again.

**Cost is small.** A single-account refresh is a handful of calls.

**Operators may refresh their own account.** 60-second cooldown, scoped to their own account and open period.

**The constraint is the promise, not the load.** A refresh button asserts the number is current. Every refresh stamps its outcome:

```
Updated 2:14 PM - 3 entries changed
Updated 2:14 PM - no changes
Refresh failed 2:14 PM - showing data from 6:02 AM
```

Silent failure on a refresh button is worse than no button.

### 9.10 Rippling change log

Rippling retains full edit provenance - we ingest it already for the retro-adjustment logic, so surfacing it is a read view over data we hold. Filterable by account, person, date range.

**Append-only, never purged.** Value is entirely in completeness.

**Gated on the §8 role model.** A log of who changed whose hours reveals patterns about individuals. Lands after PR 7.

---

## 10. Build sequence

| # | Item | Est. | Status |
|---|---|---|---|
| 0 | Export gate | 0.5d | **closed - verified clean, no leak** |
| 0b | Strip `salaryBudget` from non-admin payload | 0.5d | rides with PR 1 |
| 1 | Spine: `kpi_lines`, `kpi_line_activation`, `pnl_tab_name`, TBJ fix | 2d | **applied 2026-08-04** |
| 2 | `pnl_actuals` + parser + upload + `sc_period_locks` | 3-4d | next |
| 3 | `sc-28` sold revenue to PG | 1-2d | |
| 4 | Resolver v1 - budget only | 2-3d | |
| 5 | Revenue adapters + fee-account price fix | 4-5d | |
| 6 | `code_remap` + cost adapters | 4-5d | |
| 7 | Access spine | 10-21d | |
| 8a | Rippling raw ingest + backfill + cross-test | 3-4d | authored |
| 8b | Department map + attribution + period bucketing | 2-3d | needs map sign-off |
| 9 | TXR-V funnel tile | 3-4d | |

**Item 2 before any live pipeline** ships the lookback requirement standalone, delivers immediate value, and creates the reconciliation target every later pipeline is graded against. It is the one thing both prior attempts never had.

---

## 11. Decision log

| ID | Decision | Ruling | Date |
|---|---|---|---|
| D1 | SF classification | Follow the P&L | 08-03 |
| D2 | TXR-V in scope | In scope; Sheets source for 2026, funnel tile | 08-03 |
| D3 | `2400.2` real | Real - TXR-V's revenue line in the tracker | 08-03 |
| D4 | Fee-account variance | Suppress percentage | 08-03 |
| D5 | `users` in scope | In scope, after the upload | 08-03 |
| D6 | RDO visibility | RDOs see every account | 08-03 |
| D7 | Card source | **Rippling Spend absent from API. Upload-only. Parked, see `D7_RIPPLING_SPEND_FINDINGS.md`** | 08-03 |
| D8 | Fee workbook | Upload monthly, append-only | 08-03 |
| D9 | Season Tracker migration | Stays on Sheets for 2026 - sanctioned exception | 08-03 |
| D10 | P&L ledger | Append-only, restatements visible | 08-03 |
| D11 | H/V allocation | **CLOSED.** Separate accounts, no shared cost | 08-03 |
| D12 | TXR-V recognition | When served | 08-03 |
| D13 | Labor band source | Rippling + PG budget plane. No money tile on the Sheets labor stack | 08-03 |
| D14 | TXR-H hourly | **$110,000.** ~$40k moved to salary post-budget. Total 3100 unchanged | 08-03 |
| D15 | Bonus eligibility | Every salaried manager, on COGS budgets | 08-03 |
| D15b | Bonus target | **Total COGS** - labor, salary, food, packaging, vehicle | 08-03 |
| D16 | Weekly flash report | Not in v1. Revisit as labor-only post-Rippling | 08-03 |
| D17 | CORP | **Out of scope entirely.** Private to CEO and VPO | 08-03 |
| D18 | `3200.2` | 4% inflation savings + fun money at STL-FL and TBJ-FL | 08-03 |
| D19 | CIN-AZ SF in PG | Stays out-of-band by design | 08-03 |
| D20 | TBJ-NY rates | Owner-confirmed, four-way corroborated | 08-03 |
| D21 | P&L file shape | Current shape is the ingest contract | 08-03 |
| D22 | TXR-V terms | Net 30. Card +4%. Rain-outs case by case. Postseason billed separately | 08-03 |
| D23 | Budget authority | Live supersede-tracked rows beat the uploaded P&L; disagreements render as superseded | 08-03 |
| D24 | Labor attribution key | **`worker.department_id`.** Parse once, key on UUID. Job codes are role names | 08-03 |
| D25 | Department map | Owner-confirmed §9.7. Cardinals is **two** departments. Requires row-by-row sign-off | 08-03 |
| D26 | CIN-KY / TBJ-NY hourly | **`3100.1` is `not-applicable`** - single-employee salaried accounts | 08-03 |
| D27 | Labor cost source | `time_entry_computed_pay_segment`, Rippling-computed. No `hours x rate` | 08-03 |
| D28 | Approval state display | Unapproved hours change the number's meaning. Show unapproved dollars, entry count, approved-through date | 08-03 |
| D29 | Manual refresh | Admin and operator. 60s cooldown, own-account scope. Every refresh stamps its outcome including failure | 08-03 |
| D30 | Salary visibility | Full model §8. Nothing above site-leader outside Kevin, Josh, Joe. Corporate absent, not filtered | 08-03 |
| D31 | Compliance log | Rippling edit history as an append-only audit view. Gated on §8, lands after PR 7 | 08-03 |

---

## 12. Outstanding

### Blocking
Nothing.

### Needs investigation
- The TXR-V **-8.7% gap** between sold revenue through P7 and the P&L. Tax treatment, the 4% card surcharge, or post-cut revisions.
- Whether the **fee-account price contamination** extends beyond TXR-V to the other four.
- Whether **TXR chefs actually clock between the H and V departments** when crossing the split (§2.1).
- Whether an unrecognised `department_id` can appear mid-year, and what alerts on it.
- **The fiscal year end is undefined.** `SC_SPREADSHEET_MAPPING.md` says 357 days / 51 weeks with a three-week P13; `SOUSAI_AGENT_PLAN.md` says 13-by-4 = 364. `SC_STATUS.md` confirms there is no fiscal-calendar generator - `sc_day_metadata` is seeded from Joe's service workbooks and mirrors where service stops, not where the fiscal year ends. **357 days cannot be a fiscal year: it drifts 8 days annually and breaks year-over-year period comparability.** Decides where 7 days of salary, lease, and utility accrual land - FY2026 P13 or FY2027 P1. **Question for Joe.** `periodForDate` carries `FY2026_END` as a single provisional constant pending the ruling.

### With Joe
1. `3200.2` at STL-MO - used entirely for Supplies. Real split or seed error?
2. TBJ-FL resale composition - $28,474 total, ~$15,936 at 4%, leaving ~$12,538 fun money against STL-FL's $24,999. Per-account or should they match? *(parked)*
3. STL-FL `3200.1` labelled "Resale Food Costs" in `gl_codes`.
4. Which GL code is authoritative for TXR-V revenue - `2400.1` or `2400.2` - and who reclassified it between the Clean budget and the tracker.

### With Rippling
- What tier unlocks **"Call a public API"** - it would enable both card-spend egress and a pay-run push, and pay-run is the bigger prize.
- Are Spend or pay-run REST endpoints on the roadmap?

### Housekeeping
- `_probe_labor_budget_acceptance.mjs` compares `sum(envelopes)` to `sum(sc_labor_budgets)` - self-referential. Add a workbook-truth comparator.
- TXR-V `labor_ratio` set by direct seed write, bypassing `updateLaborRatio`; no `sc_config_changelog` row.
- No audit trail for the TXR-H $40k cut beyond a script comment.
- `sc_month_summary` returns 105 rows, exactly the `sc_services` count - may be service-scoped despite its name.
- `ai_line_items` is empty for all 55 TXR-V invoices.
- Four corrupt `invoice_date` rows need clamping.
- `labor_plans` carries the same row-order trap as `labor_sold_revenue`.

### Deferred
Postseason recognition mechanics. Weekly flash scope. Bonus-eligible viewer role.
