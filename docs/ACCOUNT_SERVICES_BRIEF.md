# KitchFix Account Services Brief

> **CANONICAL NOTICE (2026-07-16):** Per-account billing / pricing / contract truth now lives in `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md` (11 accounts, complete). This brief remains as a cross-account roster + operational-context summary. Where this doc and an account file disagree, **the account file wins.**
>
> **Money-model claims in this doc are SUPERSEDED by [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md)
> (2026-07-09 alignment).** This brief remains authoritative for per-account services,
> contract dates, and business-context detail; on any question of which price is billed,
> how service fees interact with per-meal, or how the KPI lens is computed, defer to
> SC_MONEY_MODEL.md. Line 33 below has been rewritten to match the settled model; older
> sections may still reflect the pre-2026-06-16 framing and will be trued up per-section
> in a follow-up.

Source-of-truth reference for how every KitchFix account's billing, pricing, service fees, and service calendar work. This brief is the canonical mental model for the Director of Operations (Kevin), VP Operations (Joe), site leads, and future Claude instances touching the billing module, service calendar tool, or finance stack. Last updated 2026-06-16.

Sourcing: this doc folds together the executed-contract analysis in `docs/SC_CONTRACT_BILLING_SUMMARY.md`, the per-account spreadsheet layout in `docs/SC_SPREADSHEET_MAPPING.md`, and the projection-vs-actuals price audit in `docs/archive/SC_PRICE_COMPARISON.md` (archived 2026-07-17; superseded by `docs/pricing-summit/PRICE_AUDIT.md` + per-account EVIDENCE files), with Kevin's curated 2026-06-16 source-of-truth context overlaid on top and ABR 2025 inputs (`ABR Deeper Dive - 2025.pdf`, `ABR 2025 OneSheeter.xlsx`) cross-referenced. Where ABR data disagrees with the canonical context, the contradiction is flagged inline with `[CONTRADICTION - confirm with Kevin]`.

## Executive Summary

KitchFix operates eleven distinct accounts across three site types: PDC (Player Development Complex - spring training plus year-round training facilities), MLB (Major League clubhouse inside the home stadium), and MiLB (Minor League affiliate). PDC sites are KitchFix's biggest operations and have the widest headcount swings (50 to 240 people depending on camp phase). MLB sites are predictable - ~60 to 75 people, three meals each home game, ~81 game days a year. MiLB sites are smaller and have shorter seasons but still drive their own contract and billing process.

Billing falls into two models stored in Postgres as `accounts.billing_model`. Six accounts use `actuals_drive_invoice`: meals served times per-plate price equals what the client owes. The actuals operators key into the Service Calendar tool are the line items on the invoice, so missing actuals equal uncollected revenue. Five accounts use `flat_fee`: the client pays a fixed annual amount on a contractual schedule regardless of meal count. For those accounts, the Service Calendar tracks meal counts purely for operational planning, per-meal prices are stored at $0 in Postgres (zeroed 2026-06-16), and revenue rollups must not multiply count x $0.

On top of the per-meal vs flat-fee split sit three other dimensions that have to be tracked separately: (1) **service fees** - some accounts have a flat annual service fee that lives alongside per-meal billing, some have a percentage-based service fee that discounts the per-meal rate, and some have neither; (2) **flat-fee add-ons** - extra-protein pans, extra MTOs, coffee, beverage, extended-day labor, and Boys & Girls Club lunches all carry their own per-unit rates separate from the main per-meal/service-fee scheme; (3) **non-revenue placeholders** - "Fun Money / Fun $$$$ Allocated" in the Service Calendar is an internal team-event budget and must be excluded from revenue calculations via `is_non_revenue = true`.

### Account-type and billing-model map

| account_key | Team | Type | Billing model |
|---|---|---|---|
| CIN - AZ | Cincinnati Reds (Goodyear, AZ spring training) | PDC | `actuals_drive_invoice` |
| CIN - KY | Louisville Bats (AAA) | MiLB | `actuals_drive_invoice` |
| CIN - OH | Cincinnati Reds (Great American Ballpark) | MLB | `flat_fee` |
| STL - FL | St. Louis Cardinals (Jupiter PDC) | PDC | `flat_fee` |
| STL - MO | St. Louis Cardinals (Busch Stadium) | MLB | `flat_fee` |
| TBJ - FL | Toronto Blue Jays (Dunedin PDC) | PDC | `actuals_drive_invoice` |
| TBJ - NY | Buffalo Bisons (AAA) | MiLB | `actuals_drive_invoice` |
| TBR - FL | Tampa Bay Rays (Port Charlotte PDC) | PDC | `actuals_drive_invoice` |
| TXR - AZ | Texas Rangers (Surprise, AZ spring training) | PDC | `actuals_drive_invoice` |
| TXR - TX - H | Texas Rangers (Globe Life Field, home clubhouse) | MLB | `flat_fee` |
| TXR - TX - V | Texas Rangers (Globe Life Field, visitor clubhouse) | MLB | `flat_fee` |

### Pricing model in one line

Rewritten 2026-07-09 per [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md). For `actuals_drive_invoice` accounts, the per-meal invoice line item equals `actual_count × post-SF invoice rate`. That "post-SF invoice rate" is what lives in Postgres today (per Price Review v3, 2026-06-16, Joe-reviewed): for percentage-based service-fee accounts (CIN - AZ 30%, TXR - AZ 20%, TBR - FL MiLB 25%), it equals `sticker × (1 - SF%)` and the SF is billed SEPARATELY as a flat annual amount on its own schedule (never rolled into the per-meal invoice). For flat-SF accounts (TBJ - FL) and zero-SF accounts (CIN - KY, TBJ - NY), the post-SF invoice rate equals the sticker - there is no per-meal discount. The workbook projection-tab price (sticker) is a historical planning/budget number only; it is NOT what appears on the client's invoice. For `flat_fee` accounts, per-meal prices are $0 in Postgres because billing equals the contractual fee - the calendar tracks meal counts for planning, and the fee lives in `sc_fee_schedule`.

(The former version of this paragraph, which named the projection-tab price as the billing rate, was wrong for SF% accounts - contradicted by the workbook actuals-tab formulas, the contract bible §Resolved line 87, the KPI push contract, GOTCHAS, and Kevin's Price Review v3. Corrected in the 2026-07-09 alignment.)

## Per-account deep dive

### CIN - AZ (Cincinnati Reds, Goodyear AZ - PDC spring training)

**Account type:** PDC. Cincinnati Reds spring training plus year-round MiLB training (Early Camp, MiLB ST, Extended ST, Arizona Summer League, Fall Instructs, First Year Player Camp) and rehab. Personnel: ~115 MLB during ST, ~75 to 240 MiLB depending on phase. Source: REDS/Reds & Kitchfix Signed Agreement-2023 copy.docx (effective Jan 3, 2023).

**Billing model:** `actuals_drive_invoice` (hybrid in reality: flat annual Service Fee plus per-meal Catering Fees). Per-meal volume is the variable component invoiced based on actuals.

**Service fee structure:** 30% of pre-tax annual budget estimate, flat annual. 2023 base = $402,016 (30% of $1,340,056 budget). CPI-adjusted annually per the escalation clause. Per-meal projection price is the sticker (pre-SF); actuals tab price is the 70% post-SF invoice rate. The 30% is "covered by" the annual Service Fee paid separately.

**Per-meal projection prices (operative 2026 billing rates):**

| Group | Service | Projection price | Actuals (post-SF invoice rate) | Notes |
|---|---|---|---|---|
| Major League | Breakfast | $29.01 | $20.31 | 70% post-SF invoice rate |
| Major League | Lunch | $29.01 | $20.31 | |
| Major League | Dinner | $29.01 | $20.31 | |
| Minor League | Breakfast | $18.42 | $12.90 | |
| Minor League | Lunch | $18.42 | $12.90 | |
| Minor League | Dinner | $18.42 | $12.90 | |
| Minor League | Pre-Game Snack | $7.31 | $5.12 | |
| Minor League | Coffee Service (tax-free) | $511.05/wk | $511.05/wk | `is_flat_fee, is_tax_free`; 2023 base was $450/wk with 45 wk/yr cap |
| Minor League | Fountain Bev (tax-free) | $283.92/wk | $283.92/wk | `is_flat_fee, is_tax_free`; 2023 base was $250/wk with 45 wk/yr cap |
| Rehab | Continental Plus | $9.08 | $6.36 | |
| Rehab | Breakfast | $18.42 | $12.90 | Same rate as MiLB Breakfast |
| Rehab | Lunch | $18.42 | $12.90 | |
| Rehab | Dinner | $18.42 | $12.90 | |

The 2023 contract base rates were $17.88 MLB / $11.35 MiLB / $4.51 Snack. The operative 2026 projection rates above are significantly above either the floor or cap CPI escalation off 2023 base, indicating either a separately negotiated 2026 SOW or a renegotiation outside the 2023 contract document. The operative 2026 pricing document is not in the contracts folder on file (open question - see [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md) §Open paperwork gaps). [superseded - see `pricing-summit/accounts/ACCOUNT_CIN-AZ.md`: Price Review v3 (Joe Lessard-attested, week of 2026-06-16) confirms $29.01 / $18.42 / $7.31 as the operative 2026 rates, PG-verified against sampled invoices K300168587 (MLB) + K300168736 (MiLB); no 2026 SOW is "missing", the Price Review v3 IS the operative pricing document.]

**Payment schedule:**
- Service Fee: 75% due Feb 1, remaining 25% due Mar 15 each year (per Section IV(B)(1)).
- Catering Fees: invoiced every 15 days in arrears, Net 30 (Section V(B)(C)).

**Escalation clause:** CPI-U Food Away from Home (October base). Floor 2%, cap 5%. Annual increase starting 2024 (Section IV(B)(3)).

**Contract term and renewal:** Initial Term Jan 1, 2023 - Dec 31, 2025. Renewal: two consecutive 12-month periods (2026, 2027) at Club's option, notice by Nov 1 of prior year (Section I(B)). Per ABR Deeper Dive 2025: "GOODYEAR - Through December 31, 2025 (Initial Term)... They have until Nov 1st to not renew for the 1 year" - confirms the Reds-held renewal option.

**Special provisions:**
- Force Majeure (Section VII(B), IV(F)): Club may suspend; 75% Feb-1 SF installment not refundable on FM; remaining fees prorated by `days not served / 240`.
- Educational services (cooking demos) at $1,000/class.
- 2023 Exhibit B volume threshold (72,890-meal trigger dropping MiLB rates) reads as a probable typo / pricing-tier construct since the "drop" rates are higher than base - flag for Kevin.
- Per ABR Deeper Dive 2025 p18: "Ashley has asked me about moving GY to a fee account. Could tie in nicely to an extension?" - active client conversation to convert CIN - AZ from `actuals_drive_invoice` (effectively hybrid) to `flat_fee`. Not yet executed.

**Open notes / TBD:**
- Operative 2026 pricing document for the $29.01 / $18.42 / $7.31 rates is not in the contracts folder - the 2023 base does not escalate via CPI to these numbers. Need the SOW or amendment that defines them. [superseded - see `pricing-summit/accounts/ACCOUNT_CIN-AZ.md`: Price Review v3 IS the operative document.]
- 2023 Exhibit B "volume threshold" rate construct.
- Whether the Reds will exercise their 2027 renewal option (notice by Nov 1, 2026).

### CIN - KY (Louisville Bats - AAA)

**Account type:** MiLB. AAA affiliate of the Cincinnati Reds. Smaller operation, single-season contract scope. Personnel ramp differs from a PDC. Source: Bats/BATS 2026 Contract DRAFT.docx and the executed Apr-21-2026 PDF (text-identical, OCR-confirmed).

**Billing model:** `actuals_drive_invoice`. Pure per-meal, no flat fee.

**Service fee structure:** None. No service fee in the 2026 executed contract. The 2026 DRAFT included a $24,000 lump-sum prepayment with a $2,000-per-homestand credit, but this was REMOVED in the executed Apr-21-2026 contract. If any field tool was set up against the DRAFT, the prepayment logic is now obsolete.

**Per-meal projection prices (2026 contract rates - exact match between contract and Service Calendar):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Louisville Bats | Breakfast | $25.95 | $25.95 | |
| Louisville Bats | Lunch | $25.95 | $25.95 | |
| Louisville Bats | Post-Game | $25.95 | $25.95 | Service deferred per Section 5(a)(ii) executed - parties discuss expanding into post-game in May |
| Louisville Bats | Umpire | $25.95 | $25.95 | |
| Louisville Bats | Snack | $8.64 | $8.64 | |

Estimated 2026 annual investment: $186,462 + tax (Section 4(b) executed).

**Payment schedule:**
- Weekly invoicing for the prior week's homestand meals (Section 3(a) / 4(a) executed).
- Net terms not stated explicitly in the 2026 executed; prior 2024 / 2025 contracts used weekly billing.

**Escalation clause:** None for 2026 (single-year contract). Material changes to Exhibit A SOP trigger good-faith renegotiation.

**Contract term and renewal:** Effective Date through Dec 31, 2026 (single-season). Section 2(a).

**Special provisions:**
- **72-hour outside-catering clause** (Section 5(a)(v-vi) executed): Club must give 72 hours notice for outside catering (MLB rehab dinners, etc.). Less notice means KitchFix may seek compensation for lost product. This is the clause Kevin flagged - schema has no field for tracking the billable event when triggered.
- **Minimum meals**: 11 buffet meals per standard 6-game homestand guarantee.
- Force Majeure: Club may suspend; payment obligations also suspended.
- Termination: 30-day notice for-any-reason by Club; pro-rata Services Fee due through notice period (executed only).
- Post-game service deferred per Section 5(a)(ii) - parties discuss expanding into post-game at the start of May after observing first two homestands in co-used kitchen. The Service Calendar projections include Post-Game meals from opening day, not May onward, which is an operational mismatch.

**Open notes / TBD:**
- Net payment terms not stated in 2026 executed contract.
- Post-game service start date ambiguity (contract says May; calendar says opening day).
- Per ABR PDF p19: discussion of "if/when we pull out of... Louisville" - relationship-level risk to monitor.

### CIN - OH (Cincinnati Reds MLB - Great American Ballpark)

**Account type:** MLB. Cincinnati Reds home clubhouse at Great American Ballpark. ~81 regular season games + up to 2 exhibition + postseason if Reds qualify. Up to 75 people, 3 meals per game. Source: CINN/2025-26 Reds-KitchFix Food Services Agreement.pdf (signed Nov 22, 2024).

**Billing model:** `flat_fee`. The Service Calendar projection price of $25.95 is a planning/tracking convention; client is NOT billed per-meal. Per-meal prices should be $0 in Postgres for revenue rollups.

**Service fee structure:** Flat annual Services Fee. 2025 = $357,500 (7 installments). 2026 = $362,500 + CPI escalation (6 installments).

**Per-meal projection prices (planning only, NOT billing):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Cincinnati Reds | Arrival | $25.95 | n/a | Projection only - no actuals tab in this file |
| Cincinnati Reds | Post BP | $25.95 | n/a | |
| Cincinnati Reds | Post-Game | $25.95 | n/a | |
| Cincinnati Reds | Umpire | $25.95 | n/a | |

The implied per-meal rate from `$362,500 / ~12,150 meals = ~$29.84` is higher than the $25.95 placeholder, confirming that the SC rate is a tracking convention rather than a real per-plate cost.

**Payment schedule:**
- 2025 Services Fee = $357,500 in seven installments: $56,250 on Mar 1, Apr 1, May 1, Jun 1, Jul 1, Aug 1, 2025; plus $20,000 on Jan 1, 2027 (year-end true-up / postseason holdback).
- 2026 Services Fee = $362,500 + CPI in **six** consecutive monthly installments March 1 through August 1, 2026. Section 2(a).
- Food and Disposable Supplies: invoiced after each homestand, Net 30 (Section 2(b)(d)).
- Clubhouse Extras (G&G, packaged snacks, hot coffee/tea, cold-pressed juices, kombucha, outside catering): reimbursed at cost, invoiced after each homestand, Net 30 (Section 2(c)(d)).

**Postseason rates:**
- Post Season Game Rate = $4,413.58 (1/81 of Services Fee).
- Post Season Workout Day Rate = $2,206.79 (50% of Game Rate).
- Both subject to CPI escalation.

**Escalation clause:** CPI-U Food Away from Home (August to August). Floor 1%, cap 4%. Base for 2026 = $362,500 + escalation.

**Contract term and renewal:** Effective Date - end of 2026 MLB season. Section 3(a). 2027 extension option: Reds notify by Oct 1, 2026; otherwise good-faith meet-and-confer by Nov 1, 2026.

**Special provisions:**
- Termination: 10-day cure for material breach; Reds can terminate at-will with 30 days notice + pro-rata Services Fee. Reds prepayment refunded within 5 business days (Section 3(b)).
- Force Majeure: Reds may suspend if FM causes cancellation, postponement, or Capacity Restrictions. During suspension, no obligations on either side (Section 12).
- MLB subservience: standard MLB rules-supremacy clause.

**Open notes / TBD:**
- Whether the 2027 extension option is exercised (notice by Oct 1, 2026).
- Per ABR PDF p18 / OneSheeter CIN tab: opportunity to sell "Road Food Catering Services" in a STL-style offering, not yet contracted.

### STL - FL (St. Louis Cardinals - Jupiter PDC)

**Account type:** PDC. St. Louis Cardinals MLB ST, MiLB ST, Palm Beach Cardinals (MiLB regular season) at Roger Dean Chevrolet Stadium, Jupiter, FL. Source: JUPITER/KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.docx - this is an Amendment to the base STL - MO agreement, Amendment effective Oct 3, 2025.

**Billing model:** `flat_fee`. Pure flat-fee structure. Service Calendar prices should be $0 in Postgres for revenue purposes; the per-meal numbers are planning-only.

**Service fee structure:** Total Annual Fee = $2,300,000. Broken into $1,400,000 Florida Services + $900,000 food/packaging/supplies budget (cost-reimbursable; savings revert to Cardinals; overruns billable) + upkeep allocations ($15K equipment/repair rolling, $4K storage pod, $11K ST temp cooler + electrical).

**Per-meal projection prices (planning only, NOT billing):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| MLB | Breakfast - ST | $40.00 | $40.00 | |
| MLB | Lunch - ST | $40.00 | $40.00 | |
| MiLB | Breakfast - ST | $40.00 | $40.00 | |
| MiLB | Lunch - ST | $40.00 | $40.00 | |
| MiLB | Breakfast | $26.00 | $26.00 | |
| MiLB | Lunch | $26.00 | $26.00 | |
| MiLB | Snack | (blank) | (blank) | Projection price missing - needs decision |
| Palm Beach Cardinals | Arrival | $26.00 | n/a | Projection only |
| Palm Beach Cardinals | Breakfast | n/a | $26.00 | Actuals only - new mid-season service? |
| Palm Beach Cardinals | Pre-Game | $26.00 | $26.00 | |
| Palm Beach Cardinals | Post-Game | $26.00 | $26.00 | |
| Fun Money | Fun Money allocation | $25,000 | $25,000 | NOT contractually defined; `is_non_revenue = true` planned |

**Payment schedule:**
- $1,400,000 Florida Services in quarterly installments: Nov 1 (2025), Feb 1, May 1, Aug 1 (2026), and one in 2027 per work-stoppage section. Section 2(a)(i)-(ii).
- $900,000 food/packaging/supplies budget invoiced bi-monthly (every 15 days) with receipts.
- Plus annual upkeep budgets (Section 2(b)).

**Escalation clause:** None separately stated in the Amendment (Total Annual Fee is fixed at $2.3M across the Amendment scope). Base STL - MO agreement (which this Amends) escalates by CPI-U Food Away from Home (August prior-year base), no floor/cap stated.

**Contract term and renewal:** Florida Services run alongside the base Cardinals Agreement (effective Jan 1, 2025 - Dec 31, 2027). Amendment is co-terminous.

**Special provisions:**
- **2027 work-stoppage clause (Section 2(c)):** First quarterly installment ($350K + tax) due Nov 1, 2026 is earned in full even if Florida Services don't happen Jan 1 - Mar 31, 2027 due to MLB work stoppage.
- **Standby installment:** If work stoppage continues past Mar 31, 2027, 50% of Q2 installment ($175K + tax) is due Apr 1, 2027; if any Florida Services resume after Mar 31, full Q2 installment ($350K) due with equitable adjustment for reduced MLB headcount.
- **June 30, 2027 stop-loss:** If work stoppage continues beyond June 30, parties meet and confer; neither party obligated to perform / pay after Nov 19, 2027 unless newly agreed.
- Termination for convenience: 180 days notice; can terminate just Florida Services without terminating full Agreement (Section 3(a)(ii)).
- Kitchen facility responsibility: Cardinals are responsible if their new facility isn't completed on time (Section 1(b)).
- Standard portion sizes: 10 oz protein / 6 oz starch / 6 oz vegetables. Spring training elevated to grass-fed beef, wild-caught seafood, free-range poultry, pasture-raised eggs.
- Force Majeure: standard suspension; CDC/WHO outbreaks, work stoppages enumerated (Section 6).
- "Fun Money" allocation in SC at $25,000 not contractually defined - flag for Kevin.
- Note: ABR 2025 OneSheeter does NOT include a STL Cardinals tab. The ABR Deeper Dive PDF also has no STL section. STL is excluded from the 2025 ABR process - likely because flat-fee accounts run a different review track.

**Open notes / TBD:**
- STL - FL MiLB Snack projection price is missing (no value in row 2 col S).
- Palm Beach Cardinals "Breakfast" service in actuals only - reconcile against canonical list.
- "Fun Money" allocation source / contractual basis.

### STL - MO (St. Louis Cardinals MLB - Busch Stadium)

**Account type:** MLB. St. Louis Cardinals home clubhouse at Busch Stadium. ~81 regular season games + up to 6 workout dates + 6 coordinated road series. Up to 70 individuals per meal. Source: STL/2025-27 Food Services Agreement St. Louis Cardinals + KitchFix.pdf (signed Nov 26, 2024; Effective Jan 1, 2025).

**Billing model:** `flat_fee`. Service Calendar prices should be $0 in Postgres for revenue purposes; the per-meal $25.95 is a tracking convention.

**Service fee structure:** Total Annual Service Fee = $698,000 per year. Split into Home Games Hospitality Management ($423,000) + Road Food Management ($50,000) + food/packaging/supplies budget ($225,000). 2026 figure = **base $473K / billed $489,497** (see `pricing-summit/accounts/ACCOUNT_STL-MO.md`: $473K base × CPI escalation lands at $489,497 as the operative 2026 billed figure; the earlier $489,431 phrasing was the same amount pre-escalation-rounding). Plus $60K equipment investment by Contractor over the Term, becomes Cardinals property (Section 2(e)(i)).

**Per-meal projection prices (planning only, NOT billing):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| St. Louis Cardinals | Arrival | $25.95 | $25.95 | |
| St. Louis Cardinals | Post BP | $25.95 | $25.95 | |
| St. Louis Cardinals | Post-Game | $25.95 | $25.95 | |
| St. Louis Cardinals | Umpire | $25.95 | $25.95 | |

**Payment schedule:**
- Home Games Hospitality Management: $423,000 in 6 monthly installments starting Mar 1 each year (2025/2026/2027). Section 2(a)(i).
- Road Food Management: $50,000/year due Mar 1 each year (Section 2(a)(ii)).
- Food, packaging, supplies budget: $225,000/year; monthly budget updates (not bi-monthly like Jupiter) (Section 2(a)(iii)).

**Postseason rates:**
- Post Season Game: $5,222.22
- Post Season Workout Day: $2,777.78
- Road Food Management postseason: $600
- All subject to CPI adjustment.

**Escalation clause:** CPI-U Food Away from Home (CUUR0000SEFV), based on August prior-year report. No floor/cap stated for STL (Section 2(d)(i)-(ii)).

**Contract term and renewal:** Effective Jan 1, 2025 through Dec 31, 2027 (Section 3(a)).

**Special provisions:**
- Termination for convenience: 90 days notice + tiered termination fee: $60K if in 2025, $40K if in 2026, $20K if in 2027 (Section 3(b)(ii)).
- 30-day cure for material breach.
- Registered Dietitian provided at Contractor cost; on-site up to 20 days/year (Exhibit 2).
- Road games: Contractor coordinates 6 road series on-site/in-person each season; Cardinals pay all road catering expenses; Contractor budget-tracks if budget provided.
- MLB subservience: full standard MLB clause (Section 9).

**Open notes / TBD:**
- The source-of-truth context cites a 2026 Annual Service Fee of $489,431, while the contract structure totals $698,000/yr. [RESOLVED - see `pricing-summit/accounts/ACCOUNT_STL-MO.md`: 2026 operative billed fee = $489,497 (base $473K + CPI); the $489,431 figure was the same amount at a pre-escalation rounding, and the $698K contract-structure total is the pre-2026 gross before allocation. The PG fee-schedule migration to the escalated $489,497 landed 2026-07-16.]

### TBJ - FL (Toronto Blue Jays - Dunedin PDC)

**Account type:** PDC. Dunedin FL TD Ballpark + 3031 Garrison Road training complex. MLB Player meals during ST (and regular season if applicable), FSL Single-A Dunedin Jays meals, FCL meals. Source: TBJ/Complete_with_DocuSign_Final_Dunedin_Caterin - Final.pdf (Master Services Agreement + Schedule A SOW #1 - Dunedin FL Food and Beverage Services, Effective Apr 5, 2023).

**Billing model:** `actuals_drive_invoice` (hybrid in reality: flat annual Service Fee plus per-meal Meal Fees). Per-meal volume is the dominant variable component.

**Service fee structure:** Flat annual Service Fee = $452,812/year per SOW #1 Section 12(a). Per source-of-truth context: SF does NOT discount the per-meal rate (the per-meal projection price is the full billing rate). Per ABR OneSheeter: SF Due Dates are "1/1, 2/1, 3/1 - Split Evenly" - SF split into three monthly installments Jan/Feb/Mar (not in contract text; operational practice).

**Per-meal projection prices (operative 2026 billing rates):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Major League - PDC | Breakfast | $23.12 | $23.12 | |
| Major League - PDC | Lunch | $23.12 | $23.12 | |
| Major League - PDC | Dinner | $23.12 | $23.12 | |
| Major League - PDC | Umpire | $23.12 | $23.12 | |
| Major League - PDC | Post Game Meal | $23.12 | $23.12 | |
| Major League - PDC | Snack | $1.70 | $1.70 | |
| Minor League - PDC | Breakfast | $11.55 | $11.55 | FCL Team Meal |
| Minor League - PDC | Lunch | $11.55 | $11.55 | |
| Minor League - PDC | Dinner | $11.55 | $11.55 | |
| Single A Jays | Breakfast | $16.51 | $16.51 | FSL Team Meal |
| Single A Jays | Pre-Game | $16.51 | $16.51 | |
| Single A Jays | Post-Game | $16.51 | $16.51 | |
| SSM | Stadium Staff Meals | $16.51 | $16.51 | Not in 2023 SOW base list |
| Other | MLB - Catering | $38.00 | $38.00 | Not in 2023 SOW |
| Other | MLB G&G - Pantry | $1.70 | $1.70 | Not in 2023 SOW |
| Other | MiLB G&G - Pantry | $1.70 | $1.70 | Not in 2023 SOW |
| Other | Media Meals | $16.00 | $15.00 | $1 actuals delta |
| Other | Team Canada | $11.55 | $11.55 | Not in 2023 SOW |
| Other | Scout Meals | n/a | $11.55 | Actuals-only - new mid-season service |
| Other | Fun $$$$ Allocated | $28,472.76 | $28,472.76 | `is_flat_fee, is_non_revenue` - internal team-event budget; excluded from revenue rollups |
| SSM | Florida Ops - PDC | n/a | $11.55 | Actuals-only |

2023 contract base rates were $20.29 MLB Player Meal / $14.50 FSL / $10.14 FCL / $1.50 Snack / $5.00 Shake. The ~14% gap from 2023 base to 2026 projection rates is consistent with CPI Food Away from Home cumulative escalation 2023-2026.

**Payment schedule:**
- Service Fee: $452,812/year. Per ABR OneSheeter: 3 monthly installments Jan 1, Feb 1, Mar 1 (split evenly).
- Meal Fees + Snacks + Shakes: weekly invoicing within 5 days of week end, Calendar Week = Mon-Sun. Section 12(e). Net 30 standard implied.

**Escalation clause:** CPI Food Away From Home; one increase per Agreement Year; Provider must send notice by Jan 31; Club approval not to be unreasonably withheld. Section 12(c). Per ABR PDF p15-16: "Review CPI - Currently 3.9% for July."

**Contract term and renewal:** Initial Term Feb 1, 2023 - Jan 31, 2026 (Section 5(a)). Auto-renews for up to three additional 1-year periods; Club may decline with 45 days notice prior to renewal date. As of analysis date 2026-06-16, this contract is in Renewal Term Year 1. Per ABR Deeper Dive 2025 p15: "This date would be Dec. 17th, 2025" (the 45-day notice window before Jan 31, 2026 expiration) - the renewal auto-triggered.

**Special provisions:**
- **Favored Pricing clause (MFN), Section 12(d):** Provider must make Meals/Snacks/Shakes available to Club at terms at least as favorable as any other Provider customer for equivalent or lower volume. Operational implication: any pricing discounts to other accounts could trigger TBJ rate reductions retroactively. No automated cross-account check exists.
- Force Majeure (Section 22): standard.
- Background check: full criminal investigation required for any employee with direct player/coach/staff contact (Section 4 + 12).
- Termination: Club can terminate at any time with 45 days notice. 5-day cure for default breach (Section 5(c)).
- Per ABR PDF p16: 2026 client asks include Vancouver Consulting opportunity and Jays Hotel / Suite Catering during ST.

**Open notes / TBD:**
- Stadium Staff Meals, MLB Catering, MLB/MiLB G&G - Pantry, Media Meals, Team Canada, Fun $$$$ Allocated, Scout Meals, Florida Ops - PDC, and Shake service: NONE in 2023 SOW #1 base list. Confirm whether SOW #2 amendment defines them, or if they're informal additions.
- TBJ - FL Major League - PDC "Snack" at $1.70 - the price feels low for a meal-shaped service; per the audit, confirm intended.
- Whether the Fun Money tracker (planned future tool) absorbs Fun $$$$ Allocated.

### TBJ - NY (Buffalo Bisons - AAA affiliate of TBJ)

**Account type:** MiLB. AAA affiliate of the Toronto Blue Jays. Smaller MiLB-style operation. No separate contract found in the contract package.

**Billing model:** `actuals_drive_invoice` (provisional - assuming oral or separately contracted arrangement that mirrors per-meal billing).

**Service fee structure:** None on file. Status unknown.

**Per-meal projection prices (operative 2026 billing rates):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Buffalo Bisons | Breakfast | $27.34 | $27.34 | |
| Buffalo Bisons | Lunch | $27.34 | $27.34 | |
| Buffalo Bisons | Post-Game | $27.34 | $27.34 | |
| Buffalo Bisons | Umpire | $27.34 | $27.34 | |
| Buffalo Bisons | Snack | $0.00 | $0.00 | Projection price missing - import with price = 0 per audit |
| Buffalo Bisons | Shake | $0.00 | $0.00 | Projection price missing - import with price = 0 per audit |

**Payment schedule:** Unknown.

**Escalation clause:** Unknown.

**Contract term and renewal:** Unknown - no contract on file.

**Special provisions:**
- **No executed agreement is in this contract package.** The TBJ master Services Agreement and SOW #1 scope explicitly to Dunedin (TD Ballpark + 3031 Garrison Road); Buffalo is not mentioned in the agreement text.
- Possible explanations: (a) separate SOW #2 not included in the contract package, (b) informal arrangement, (c) different contracting entity (Rogers / Blue Jays may have a separate AAA affiliate contract).
- Note: TBJ - NY is NOT included in the 2025 ABR OneSheeter or Deeper Dive PDF. ABR PDF p16 lists "How is Buffalo going from your perspective?" as one of three questions to ask Michelle - confirming Buffalo is a live relationship but treated as adjacent.

**Open notes / TBD:**
- **Source of contractual terms for TBJ - NY** - flag for Kevin to surface or document any informal arrangement.
- **Snack and Shake pricing** ($0 placeholders - real services awaiting pricing decision).
- Whether MFN clause from TBJ - FL master applies cross-affiliate.

### TBR - FL (Tampa Bay Rays - Port Charlotte PDC)

**Account type:** PDC. Tampa Bay Rays MLB ST + MiLB ST + MiLB regular season at Charlotte Sports Park. Also covers a separate Boys & Girls Club of Charlotte County lunch catering operation. Sources: TBR/Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf + Major League SOW 2024 EXECUTION + Services Agreement Minor League Foodservice + Minor League SOW 2024 EXECUTION.

**Billing model:** `actuals_drive_invoice`. ML is pure per-meal; MiLB has a **recurring** annual Service Fee ($200K + variable) that discounts MiLB per-meal rates by 25%. [superseded - see `pricing-summit/accounts/ACCOUNT_TBR-FL.md`: the "one-time 2024 front-load" reading is stale; the SF cadence recurs each year matching the 2024 structure.]

**Service fee structure:**
- **ML side:** No service fee.
- **MiLB side:** $382,448 Service Fee (2024 baseline), with $200,000 due upon SOW signing + $182,448 due Feb 1, 2024. Per source-of-truth context: 25% service fee credit reduces MiLB per-meal rates to 75% of the base. [RESOLVED - see `pricing-summit/accounts/ACCOUNT_TBR-FL.md`: SF is **recurring** each year (structure: $200K + variable remainder due Feb 1), NOT a one-time 2024 front-load. The ABR OneSheeter reading (recurring annual) is correct; the SC_CONTRACT_BILLING_SUMMARY "one-time" reading is stale.]

**Per-meal projection prices (operative 2026 billing rates):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Major League | Breakfast | $35.63 | $35.63 | |
| Major League | Lunch | $39.48 | $39.48 | |
| Major League | Dinner | $39.48 | $39.48 | |
| Major League | Umpire Meal | $39.48 | n/a | Projection only - actuals tab drops Umpire Meal |
| Major League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | `is_flat_fee` per-pan add-on |
| Major League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | `is_flat_fee` per-pan add-on |
| Major League | MLB - Extra MTO - Sm | $5.00 | $5.00 | `is_flat_fee` |
| Major League | MLB - Extra MTO - Med | $10.00 | $10.00 | `is_flat_fee` |
| Major League | MLB - Extra MTO - Lrg | $15.00 | $15.00 | `is_flat_fee` |
| Minor League | Breakfast - MiLB ST | $23.77 | n/a | Projection only (base rate, no SF discount) |
| Minor League | Breakfast - MiLB | n/a | $17.83 | Actuals only (post-SF-credit, 75% of $23.77) |
| Minor League | Lunch - MiLB ST | $28.90 | n/a | Projection only |
| Minor League | Lunch - MiLB | n/a | $21.67 | Actuals only |
| Minor League | Dinner | $27.95 | $20.96 | -$6.99 delta |
| Minor League | AFTER HOURS MEALS | $27.95 | $20.96 | -$6.99 delta |
| Minor League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | `is_flat_fee` |
| Minor League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | `is_flat_fee` |
| Minor League | Road Sandwiches - MiLB | $15.00 | $15.00 | |
| Minor League | Extended Day labor | n/a | $280.00 | `is_flat_fee` per-day add-on, actuals-only |
| Boys & Girls Club | B&G Lunch | $6.50 | $6.50 | `is_tax_free`, separate client (see Special provisions) |

2024 contract base ML rates were $32.98 Breakfast / $36.54 Lunch+Dinner+Umpire. MiLB 2024 base = $21.11 Breakfast (base) / $15.84 (post-SF-credit) / $25.86 Lunch+Dinner (base) / $19.40 (post-SF-credit). The 2026 projections are consistent with 75% of CPI Food Away from Home (Nov-to-Nov) escalation off the 2024 base.

**Payment schedule:**
- MiLB Service Fee: $200,000 due upon SOW signing + $182,448 by Feb 1, 2024 (per 2024 SOW). Per ABR OneSheeter cadence ("200k 'on the first day', Remaining due 2/1") this same structure is applied annually.
- Per-meal Catering Fees (both ML and MiLB): weekly invoicing within 5 days of week-end (Section 6(b)). Net 30 (Club makes reasonable efforts to pay by invoice due date).

**Escalation clause:** 75% of CPI-U Food Away from Home - Full Service Meals and Snacks (Nov-to-Nov). Section 6(c) ML SOW / Section 6(a)(v-vi) MiLB SOW. Adjusts both Base and Post-SF rates.

**Contract term and renewal:** Initial Term Jan 1, 2024 - Oct 1, 2026 for both ML and MiLB (Section 3 ML). First Extension Option through Dec 31, 2027 (notice by Oct 1, 2026). Second Extension Option through Dec 31, 2028 (notice by Nov 2027, if First Extension exercised). Per ABR OneSheeter: "Good Through: End of 2026, +1 options through 2028 available."

**Special provisions:**
- **Right of First Negotiation (relocation), Section 5 ML:** If Rays announce a new Spring Training Site other than Charlotte Sports Park, Contractor has exclusive 30-day window to negotiate modification of both ML and MiLB agreements for the new site. If no agreement reached, Club is free to negotiate with third parties and agreements terminate when Rays vacate. Per ABR PDF p13: "they are going to be leaving the Tampa area" - active relocation watch.
- **Boys & Girls Club of Charlotte County (B&G) - separate client:** Contract dated 2025-08-03. School year Tue-Thu, 125 minimum/day, $6.50/meal, tax exempt, prepaid per 4-week period. NOT covered by either ML or MiLB Rays SOW. Model as service group `Boys & Girls Club` under TBR - FL account_key with separate billing stream tracking.
- Force Majeure (Section 4 ML): Suspension Events include MLB delays/cancellations; Club excused from Service Fee during Suspension Event; parties negotiate in good faith for partial Services.
- Termination: 10-day cure on default; Club can terminate at any time for any reason on 45 days notice (master agreement standard) (Section 3).
- Insurance limits unusually high: $10M each occurrence / $10M aggregate on General Liability; $10M auto (reflects Tropicana Field exposure).

**Open notes / TBD:**
- **MiLB Service Fee continuation past 2024:** [RESOLVED - see `pricing-summit/accounts/ACCOUNT_TBR-FL.md`: SF recurs annually, structure $200K + variable remainder. Not one-time.]
- Extra Protein, MLB Extra MTO, Extended Day Labor, AFTER HOURS MEALS, Road Sandwiches: not in 2024 SOW base list. Confirm canonical service list / SOW amendment.
- TBR - FL MiLB Dinner spreadsheet rate $27.95 is significantly higher than the 2024 post-discount Dinner rate $19.40 - the $27.95 is a different service mapping than the 2024 SOW implies. Audit confirms 44% gap between contract Dinner and spreadsheet Dinner; the spreadsheet may be using a base rate, not the discounted rate.
- B&G - whether the contract auto-renews for the 2026-2027 school year.

### TXR - AZ (Texas Rangers - Surprise AZ PDC)

**Account type:** PDC. Texas Rangers Surprise AZ Spring Training facility. MLB ST, Non-MLB (extended camp / instructs / FCL Rangers / rehab) full-service buffet for breakfast/lunch/dinner, MTO once a month during breakfast, Coffee & Beverage (excluding bottled water/sports/protein drinks), Grab + Go all-day. Source: TXR-AZ/Texas Rangers 2025-2027 Surprise Food Service Agreement.pdf (master agreement Effective Dec 13, 2024; SOW #1 dated Jan 7, 2025 covering 2025 season).

**Billing model:** `actuals_drive_invoice`. Per-meal billing + 20% annual deposit that triggers a 20% per-meal discount.

**Service fee structure:** 20% Annual Deposit on total projected Services Fee. 2025 Total Annual Deposit = $297,419.26 (3 installments of $99,139.75 on Jan 1, Feb 1, Mar 1). Paying the deposit triggers the 20% discount on every Per-Meal Fee for the year. 2026 deposit TBD by 2026 projected meal volume; no 2026 SOW in the contract package as of analysis date.

The projection tab price is the **list rate**. The actuals tab price is the **80% post-deposit rate**. Both are operationally correct depending on whether the deposit has been paid.

**Per-meal projection prices (operative 2026 billing rates):**

| Group | Service | Projection price (list) | Actuals (post-SF) | Notes |
|---|---|---|---|---|
| Major League | Breakfast | $35.72 | $28.58 | -20% post-deposit |
| Major League | Lunch | $35.72 | $28.58 | |
| Major League | Dinner | $35.72 | $28.58 | |
| Major League | Extra Protein - Chicken/Pork | n/a | $115.00 | `is_flat_fee`, actuals-only |
| Major League | Extra Protein - Beef/Seafood | n/a | $165.00 | `is_flat_fee`, actuals-only |
| Minor League | Breakfast | $17.87 | $14.29 | |
| Minor League | Lunch | $17.87 | $14.29 | |
| Minor League | Dinner | $17.87 | $14.29 | |
| Minor League | Continental Breakfast | $8.20 | $6.56 | NEW - not in 2025 SOW pricing |
| Minor League | Pre-Game Hot Snack | $13.66 | $10.93 | |
| Minor League | Regular Snack | $7.36 | $5.89 | |
| Minor League | Extra Protein - Chicken/Pork | n/a | $115.00 | `is_flat_fee`, actuals-only |
| Minor League | Extra Protein - Beef/Seafood | n/a | $165.00 | `is_flat_fee`, actuals-only |

**Payment schedule:**
- Annual Deposit: 20% of total Services Fee, calculated on projected daily meals under all active SOWs. Section 2(b) master.
- Deposit due in 3 equal installments Jan 1, Feb 1, Mar 1 of each Term year.
- Per-meal fees invoiced weekly (Mon-Sun) for prior week's meals. Net 30. Section 3 master.

**Escalation clause:** Built-in 2.5% annual increase for 2026 and 2027 (over prior year). Section 2(a) master. Per ABR PDF p7: "CPI is actually 3.8, we're only asking for 2.5%" - the 2.5% is contractually fixed.

**Contract term and renewal:** Initial Term Jan 1, 2025 - Dec 31, 2027 (Section 4(a) master). Renewal: up to 3 additional 1-year periods at Rangers' option, 90 days notice.

**Special provisions:**
- **Kitchen improvements investment:** Provider pays up to $75,000 for kitchen equipment installed at Team Facility (Section 5 master). Pro-rata refundable on Team termination.
- Termination: 10-day cure on material breach. At-will: Team may terminate with 4 months prior notice + pro-rata Services Fee (Section 4(c)). If Team terminates without breach: Team must pay pro-rata of up to $75,000 spent on kitchen equipment installed at Team Facility. Provider retains any Service Fees previously paid.
- Non-solicitation: Team cannot solicit Provider clients/employees for 2 years post-termination (Section 7(f)).
- Force Majeure: not separately defined in master; defers to general MLB subservience clauses.
- Per ABR PDF p10: "Introduction of Fun Money to TXR AZ?" - active discussion of adding a Fun Money budget allocation for TXR AZ.

**Open notes / TBD:**
- 2026 SOW with 2026-projected deposit amount.
- MLB Dinner, Continental Breakfast, and Extra Protein services in spreadsheet but NOT in the 2025 SOW pricing tables. Either added by informal amendment, captured in a 2026 SOW not on file, or operational additions captured ahead of contractual definition.
- Per ABR PDF p5: "ST related travel: $8,400 over budget. We overspend on MLB Chef support during ST" - cost/scope pressure not in contract.

### TXR - TX - H (Texas Rangers MLB Home - Globe Life Field, Arlington)

**Account type:** MLB. Texas Rangers home clubhouse at Globe Life Field. ~81 home games + 1 workout day, 3 meals per game for 60 people. Source: TXR/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf (Effective Jan 21, 2026).

**Billing model:** `flat_fee`. Service Calendar prices should be $0 in Postgres for revenue purposes; the per-meal $25.95 is a tracking convention.

**Service fee structure:** Pure flat annual Services Fee = $604,032 for 2026. No per-meal billing.

**Per-meal projection prices (planning only, NOT billing):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Texas Rangers | Arrival | $25.95 | n/a | Projection only - no actuals tab |
| Texas Rangers | Post BP | $25.95 | n/a | |
| Texas Rangers | Post-Game | $25.95 | n/a | |
| Texas Rangers | Umpire | $25.95 | n/a | |

**Payment schedule:**
- Six monthly installments April 1 - September 1, 2026. Each = $100,672 pre-tax / $108,977.44 with sales tax (Section 2(a)).
- Invoiced 30 days in advance of each due date.
- Postseason: pro-rata Services Fee for each 2026 Postseason Game.

**Escalation clause:** Built into the annual contract (no CPI escalator). 2025 was $549,120; 2026 is $604,032 = 10% YoY built-in increase. Future years renegotiated annually.

**Contract term and renewal:** Effective Jan 21, 2026 - Dec 31, 2026 (single-season contract). Annual renewal model.

**Special provisions:**
- **Catering allowance:** 12 post-game outside catered meals/year - Contractor coordinates ordering, Rangers pay catering cost. Contractor still provides standard all-day food + attendant present on those dates (Section 2(b)).
- Personnel ramp: 75% of full workforce hired and trained by Mar 1, 2026; minimum 6 fully-trained staff at Globe Life Field throughout regular season (Section 4(e)).
- Daily offerings: Grab & Go snacks, packaged snacks/condiments/beverages, coffee service, MTO during first two meals each home game.
- Termination: 10-day cure on material breach. At-will with 30 days notice + pro-rata Services Fee through notice period (Section 3(b)).
- Force Majeure: not separately defined; subject to general MLB subservience suspension.
- MLB subservience: standard (Section 14).
- Per ABR PDF p4: "Arlington - Annual Renewal *the push here would be to try and convert to a fee model" - this account is ALREADY a fee model; the ABR language likely refers to convincing Surprise (TXR - AZ) into a fee model. Cross-reference flag.

**Open notes / TBD:**
- 2027 renewal not yet contemplated in this single-year contract.

### TXR - TX - V (Texas Rangers MLB Visitors - Globe Life Field)

**Account type:** MLB. Visitor clubhouse at Globe Life Field. Bundled into the same physical contract as TXR - TX - H. Source: Same contract as TXR - TX - H - Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf.

**Billing model:** `flat_fee`. The visitor clubhouse is NOT separately billed - it's bundled into the $604,032 home contract.

**Service fee structure:** $0 separately. Bundled in TXR - TX - H flat annual fee.

**Per-meal projection prices (planning only, NOT billing - and scope-mismatched, see Special provisions):**

| Group | Service | Projection price | Actuals | Notes |
|---|---|---|---|---|
| Texas Rangers | Arrival | $25.95 | $25.95 | Scope-mismatched |
| Texas Rangers | Post BP | $25.95 | $25.95 | Scope-mismatched |
| Texas Rangers | Post-Game | $25.95 | $25.95 | Scope-mismatched |
| Texas Rangers | Umpire | $25.95 | $25.95 | Scope-mismatched |

**Payment schedule:** N/A - rolled into TXR - TX - H schedule.

**Escalation clause:** N/A - rolled into TXR - TX - H.

**Contract term and renewal:** Same as TXR - TX - H.

**Special provisions:**
- **Visitor clubhouse contractual scope, Section 1(b)** is limited to: Grab & Go snack options made by Contractor; packaged snacks, condiments, beverages; coffee service. NO buffet, NO MTO, NO per-meal billing.
- The Service Calendar for TXR - TX - V models the full set of MLB-style buffet services (Arrival / Post BP / Post-Game / Umpire). This is **inconsistent with the contractually defined visitor scope**. Either (a) the SC over-models from the home template, or (b) operational reality includes more than the contract scope (ad-hoc visiting-team catering reimbursed separately).
- Per ABR PDF p6: "Visiting Team - Financially doesn't make sense to have a year round chef - Jordan is no longer going to be employed year round" - operational scope reduction planned for the visitor side.
- Per ABR PDF p9-10: "We also need to set up a visiting side innovation convo with Mason, Matt... explain the structural changes (reduced chef hours), pitch creative hospitality upgrades for 2026."

**Open notes / TBD:**
- Whether to delete the V-clubhouse buffet services from the SC (contract scope = G&G + snacks + coffee only) or keep them as ad-hoc reimbursable tracking.
- 2026 visitor-side strategy / billing model post the chef-hour reduction.

## Cross-account comparison tables

### Pricing side-by-side (per-meal projection rates)

| Service | CIN-AZ MLB | CIN-AZ MiLB | CIN-KY | CIN-OH | STL-FL MLB | STL-FL MiLB | STL-MO | TBJ-FL MLB | TBJ-FL MiLB | TBJ-FL Sgl A | TBJ-NY | TBR-FL MLB | TBR-FL MiLB | TXR-AZ MLB | TXR-AZ MiLB | TXR-TX-H | TXR-TX-V |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Breakfast | $29.01 | $18.42 | $25.95 | n/a | $40 ST | $26 / $40 ST | n/a | $23.12 | $11.55 | $16.51 | $27.34 | $35.63 | $23.77 ST | $35.72 | $17.87 | n/a | n/a |
| Lunch | $29.01 | $18.42 | $25.95 | n/a | $40 ST | $26 / $40 ST | n/a | $23.12 | $11.55 | n/a | $27.34 | $39.48 | $28.90 ST | $35.72 | $17.87 | n/a | n/a |
| Dinner | $29.01 | $18.42 | n/a | n/a | n/a | n/a | n/a | $23.12 | $11.55 | n/a | n/a | $39.48 | $27.95 | $35.72 | $17.87 | n/a | n/a |
| Arrival | n/a | n/a | n/a | $25.95 | n/a | n/a | $25.95 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | $25.95 | $25.95 |
| Post BP | n/a | n/a | n/a | $25.95 | n/a | n/a | $25.95 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | $25.95 | $25.95 |
| Post-Game | n/a | n/a | $25.95 | $25.95 | n/a | n/a | $25.95 | n/a | n/a | $16.51 | $27.34 | n/a | n/a | n/a | n/a | $25.95 | $25.95 |
| Umpire | n/a | n/a | $25.95 | $25.95 | n/a | n/a | $25.95 | $23.12 | n/a | n/a | $27.34 | $39.48 | n/a | n/a | n/a | $25.95 | $25.95 |
| Snack (per meal) | n/a | $7.31 | $8.64 | n/a | n/a | (missing) | n/a | $1.70 | n/a | n/a | $0.00 | n/a | n/a | n/a | $7.36 reg / $13.66 hot | n/a | n/a |

Reminder: for the five `flat_fee` accounts (CIN-OH, STL-FL, STL-MO, TXR-TX-H, TXR-TX-V), the per-meal numbers above are operational tracking only and Postgres stores $0 for revenue purposes.

### Service fee structures

| account_key | SF type | SF amount (current year) | Effect on per-meal pricing | Cadence |
|---|---|---|---|---|
| CIN - AZ | 30% of budget, flat annual | $402,016 (2023 base) + CPI to date | Reduces per-meal to 70% of projection (projection = full billing rate) | 75% Feb 1 + 25% Mar 15 |
| CIN - KY | None | $0 | No discount; per-meal billed full | n/a |
| CIN - OH | Flat Services Fee | $362,500 (2026 base) + CPI | No per-meal billing - fee IS billing | 6 monthly Mar-Aug |
| STL - FL | Flat Total Annual Fee | $2,300,000 | No per-meal billing - fee IS billing | Quarterly Nov/Feb/May/Aug + bi-monthly food budget |
| STL - MO | Flat Annual Service Fee | base $473K / billed $489,497 (2026 escalated actual, PG updated 2026-07-16); see `pricing-summit/accounts/ACCOUNT_STL-MO.md` | No per-meal billing - fee IS billing | 6 monthly Mar-Aug |
| TBJ - FL | Flat annual SF + per-meal on top | $452,812/yr | No discount; per-meal billed full alongside SF | 3 monthly Jan/Feb/Mar (per ABR) |
| TBJ - NY | Unknown (no contract on file) | Unknown | Full per-meal assumed | Unknown |
| TBR - FL ML | None | $0 | No discount; per-meal billed full | n/a |
| TBR - FL MiLB | 25% credit from $382,448 SF (2024 baseline; **recurring annually**) | $200K + variable remainder, recurring each year (see `pricing-summit/accounts/ACCOUNT_TBR-FL.md`) | Reduces MiLB per-meal to 75% of base | $200K on-first-day + remainder due Feb 1 |
| TXR - AZ | 20% deposit triggers 20% discount | $297,419.26 (2025); 2026 TBD | Reduces per-meal to 80% of list | 3 installments Jan 1 / Feb 1 / Mar 1 |
| TXR - TX - H | Flat annual | $604,032 (2026) | No per-meal billing - fee IS billing | 6 monthly Apr-Sep |
| TXR - TX - V | Bundled in TXR - TX - H | $0 separately | No per-meal billing | Per TXR - TX - H schedule |

### Payment terms (invoicing frequency + fee schedule + net terms)

| Account | Invoicing cadence (variable) | Fee schedule (fixed) | Net terms |
|---|---|---|---|
| CIN - AZ | Every 15 days in arrears (catering fees) | 75% Feb 1 + 25% Mar 15 (SF) | Net 30 |
| CIN - KY | Weekly (prior week's homestand meals) | N/A | Not stated |
| CIN - OH | After each homestand (food/supplies + extras) | 6 monthly Mar-Aug 2026 (SF) | Net 30 |
| STL - FL | Bi-monthly (food/supplies budget) | Quarterly Nov/Feb/May/Aug | N/A |
| STL - MO | Monthly (food/supplies budget) | 6 monthly Mar-Aug (SF) | Net 30 |
| TBJ - FL | Weekly Mon-Sun, within 5 days (meals/snacks/shakes) | 3 monthly Jan/Feb/Mar (SF) per ABR | Net 30 implied |
| TBJ - NY | Unknown | Unknown | Unknown |
| TBR - FL | Weekly, within 5 days of week-end (meals) | $200K signing + $182,448 Feb 1 (MiLB SF) | Net 30 |
| TXR - AZ | Weekly Mon-Sun (per-meal fees) | 3 installments Jan 1 / Feb 1 / Mar 1 (deposit) | Net 30 |
| TXR - TX - H | Invoiced 30 days ahead of each installment | 6 monthly Apr-Sep | Per schedule |
| TXR - TX - V | Bundled in TXR - TX - H | Bundled | Bundled |

### Escalation methodologies

| Account | Type | Floor / cap | Reference series + base month |
|---|---|---|---|
| CIN - AZ | CPI-U Food Away from Home | 2% floor / 5% cap | Annual, October base |
| CIN - KY | None (single-year contract) | n/a | n/a |
| CIN - OH | CPI-U Food Away from Home | 1% floor / 4% cap | August base |
| STL - FL | None separately (base STL agreement applies via Amendment) | n/a | n/a (Amendment fixes Total Annual Fee) |
| STL - MO | CPI-U Food Away from Home (CUUR0000SEFV) | None stated | August prior-year |
| TBJ - FL | CPI Food Away from Home | Max 1 increase/year; Provider notifies by Jan 31 | Q4 prior year |
| TBJ - NY | Unknown | n/a | n/a |
| TBR - FL | 75% of CPI-U Food Away (Full Service Meals and Snacks) | None stated | Nov-to-Nov |
| TXR - AZ | Built-in 2.5%/yr | n/a (fixed) | Fixed for 2026 and 2027 |
| TXR - TX - H | Built into annual contract | n/a | 10% YoY for 2026 ($549K -> $604K); annual renegotiation |
| TXR - TX - V | Built into TXR - TX - H | n/a | n/a |

### Contract end dates and renewal triggers

| Account | Initial Term end | Renewal options | Notice trigger |
|---|---|---|---|
| CIN - AZ | Dec 31, 2025 | 2x 12-month at Club option (2026, 2027) | Nov 1 of prior year |
| CIN - KY | Dec 31, 2026 | Single-season; renegotiate | n/a |
| CIN - OH | End of 2026 MLB season | 1x at Reds option for 2027 | Notify by Oct 1, 2026; otherwise meet-and-confer Nov 1, 2026 |
| STL - FL | Dec 31, 2027 (co-terminous with STL - MO) | None stated separately | n/a |
| STL - MO | Dec 31, 2027 | None stated | n/a |
| TBJ - FL | Jan 31, 2026 | Auto-renew up to 3x 1-year (Renewal Term Year 1 in progress) | Club must decline with 45 days notice (~Dec 17 each cycle) |
| TBJ - NY | Unknown | Unknown | Unknown |
| TBR - FL (ML and MiLB) | Oct 1, 2026 | 1st extension through Dec 31, 2027; 2nd extension through Dec 31, 2028 | 1st: Oct 1, 2026. 2nd: Nov 2027 |
| TXR - AZ | Dec 31, 2027 | Up to 3x 1-year at Rangers option | 90 days notice |
| TXR - TX - H | Dec 31, 2026 | Annual renewal model | n/a |
| TXR - TX - V | Dec 31, 2026 (bundled) | Bundled | Bundled |

Renewals coming up next (chronologically):
1. **CIN - AZ Nov 1, 2026** - Reds either exercise 2027 renewal option or contract expires Dec 31, 2026.
2. **CIN - OH Oct 1, 2026** - Reds either exercise 2027 extension or trigger meet-and-confer Nov 1.
3. **TBR - FL Oct 1, 2026** - Rays either exercise 1st extension through Dec 31, 2027 or contract terminates.
4. **TBJ - FL Dec 17, 2026** - Auto-renew unless Club declines (Renewal Term Year 2 trigger).
5. **TXR - TX - H Dec 31, 2026** - Annual contract; 2027 renegotiated separately.
6. **CIN - KY Dec 31, 2026** - Single-season; renegotiated for 2027.

## Service Calendar behavior per billing model

The Service Calendar (SC) tool tracks meal counts (projections + actuals) for every account regardless of billing model. The downstream interpretation differs:

**For `actuals_drive_invoice` accounts (CIN-AZ, CIN-KY, TBJ-FL, TBJ-NY, TBR-FL, TXR-AZ):**
- The actuals entered by operators each week ARE the invoice line items.
- `actuals_count x projection_price = billed amount` for each (date, service) pair.
- Missing actuals = lost revenue. There is no way to recover what was never entered.
- Operators must reconcile actuals against the homestand schedule weekly.
- For accounts with percentage-based SFs (CIN-AZ, TXR-AZ, TBR-FL MiLB), the projection price is the full billing rate. The actuals tab price is internal cost-basis tracking only.
- Per-pan / per-day flat-fee add-ons (Extra Protein, Extra MTO, Extended Day Labor) are billed by count of pans/days x the flat price, separate from the meal/SF structure.

**For `flat_fee` accounts (CIN-OH, STL-FL, STL-MO, TXR-TX-H, TXR-TX-V):**
- The SC tracks meal counts for operational planning (headcount forecasting, food ordering, labor scheduling). It is NOT the billing source.
- Per-meal prices are stored at $0 in Postgres (zeroed 2026-06-16) because billing = the contractual flat fee paid on its own installment schedule.
- Revenue rollups (e.g., `sc_month_summary`) must NOT multiply count x $0. Either bypass the per-meal multiplication for `flat_fee` accounts entirely or sum from a separate `billing_module` fixed-fee schedule.
- Cost-reimbursement components (food/supplies budget at STL-FL, STL-MO, CIN-OH) are NOT in the SC - they live in the AP / accounting system downstream.

**The `is_non_revenue` flag exclusion:**
- Services flagged `is_non_revenue = true` in `sc_services` must be excluded from revenue rollups across both billing models. The current case is `Fun $$$$ Allocated` at TBJ-FL ($28,472.76 flat-fee item) and the planned move of TXR-AZ "Fun Money" and STL-FL "Fun Money" allocation into the same pattern.
- The future Fun Money Tracker tool will absorb these allocations and let SC drop the service-level tracking entirely.

**The `is_flat_fee` flag:**
- For add-on services billed per-pan or per-event (Extra Protein, MLB Extra MTO, Coffee Service, Fountain Beverage, Extended Day Labor, B&G Lunch), the price is per-unit-of-service-rendered, not per-meal. Billing module should treat these as line items with `qty x unit_price`, not as meal-count multiplications.

**The `is_tax_free` flag:**
- Coffee Service / Fountain Bev at CIN-AZ and B&G Lunch at TBR-FL are tax-exempt at the service level. All other per-meal services are subject to state-specific sales tax (itemized separately on the invoice per every executed contract's tax clause). The SC tool does not currently apply tax; tax-applied projection is handled downstream.

## Open questions and missing information

Pulled from per-account "Open notes / TBD" sections plus ABR-surfaced items:

1. **CIN - AZ operative 2026 pricing document.** The 2023 contract base ($17.88 MLB / $11.35 MiLB / $4.51 Snack) does not CPI-escalate to the 2026 projection rates ($29.01 / $18.42 / $7.31) even at the 5% cap for 3 years. The operative 2026 SOW or pricing amendment is not in the contracts folder. [superseded - see `pricing-summit/accounts/ACCOUNT_CIN-AZ.md`: Price Review v3 (Joe Lessard-attested) IS the operative 2026 pricing document; PG + sampled invoices confirm.]
2. **CIN - AZ Exhibit B volume threshold (72,890-meal trigger).** Reads as a probable typo since the "drop" rates are higher than base. Confirm intent.
3. **CIN - AZ 2027 renewal option.** Reds notice by Nov 1, 2026.
4. **CIN - AZ fee-model conversion.** Per ABR PDF p18: "Ashley has asked me about moving GY to a fee account." Not yet executed.
5. **CIN - KY net payment terms** not stated in 2026 executed contract.
6. **CIN - KY post-game service start date** ambiguity (contract says May; calendar says opening day).
7. **CIN - OH 2027 extension option.** Reds notice by Oct 1, 2026.
8. **STL - MO 2026 Service Fee amount.** Source-of-truth context says $489,431. Contract text totals $698,000. [RESOLVED - see `pricing-summit/accounts/ACCOUNT_STL-MO.md`: base $473K + CPI escalation = $489,497 billed (2026); the earlier $489,431 figure was a rounding/typo of the same escalated amount. The $698K figure was the pre-2026 contract structure gross before allocation split.]
9. **STL - FL MiLB Snack projection price missing** (no value in row 2 col S).
10. **STL - FL Palm Beach Cardinals "Breakfast"** in actuals only - reconcile against canonical list.
11. **STL - FL Fun Money allocation** ($25,000) source / contractual basis.
12. **TBJ - FL services not in 2023 SOW base list:** Stadium Staff Meals, MLB Catering, MLB/MiLB G&G Pantry, Media Meals, Team Canada, Fun $$$$ Allocated, Scout Meals, Florida Ops - PDC, Shake. Confirm SOW #2 amendment or informal additions.
13. **TBJ - FL Major League - PDC Snack at $1.70** - feels low for a meal-shaped service; per the audit, confirm intended.
14. **TBJ - NY entire contract status.** No executed agreement on file. Buffalo Bisons may be on separate SOW #2 or oral / informal arrangement.
15. **TBJ - NY Snack and Shake pricing** ($0 placeholders).
16. **TBJ MFN cross-affiliate scope:** does the Section 12(d) Favored Pricing clause apply across the TBJ - NY relationship?
17. **TBR - FL MiLB Service Fee continuation past 2024.** [RESOLVED - see `pricing-summit/accounts/ACCOUNT_TBR-FL.md`: recurring $200K + variable each year.]
18. **TBR - FL non-SOW services:** Extra Protein, MLB Extra MTO, Extended Day Labor, AFTER HOURS MEALS, Road Sandwiches.
19. **TBR - FL MiLB Dinner price gap** (44% above 2024 post-discount Dinner rate).
20. **TBR - FL B&G contract auto-renew status** for the 2026-2027 school year (current contract dated 2025-08-03).
21. **TBR - FL relocation risk.** Per ABR PDF p13: "they are going to be leaving the Tampa area." Right of First Negotiation triggers when announced.
22. **TXR - AZ 2026 SOW.** No 2026 SOW in the contract package; deposit amount TBD.
23. **TXR - AZ non-SOW services:** MLB Dinner, Continental Breakfast, Extra Protein.
24. **TXR - AZ Fun Money introduction.** Per ABR PDF p10: "Introduction of Fun Money to TXR AZ?" - active discussion.
25. **TXR - TX - V scope mismatch.** Visitor clubhouse contract scope is G&G + snacks + coffee only; SC models full buffet services. Decide whether to delete the buffet services or keep them as ad-hoc tracking.
26. **TXR - TX - V 2026 strategy.** Chef-hour reduction (Jordan no longer year-round per ABR PDF p6). New billing/operational model TBD.

### ABR-surfaced items worth noting

The ABR Deeper Dive 2025 PDF and OneSheeter xlsx surface several items not in the contracts folder or SOT context:

- **Risk assessments per account** (overall sentiment):
  - TXR - AZ: Medium (staffing turnover risk; "always yes" mentality cost pressure)
  - TXR - TX - H: Medium (snack/packaged goods spend Home and Visiting)
  - TBR - FL: Low now, Medium later (relocation risk - leaving Tampa area)
  - TBJ - FL: Low (top-down KitchFix advocacy; Diego hire stabilizing culinary)
  - CIN - AZ + CIN - OH: Low
- **YTD financials (through period 7, 2025 - from OneSheeter):**
  - TXR (combined AZ + TX): YTD vs Budget -$43,337; YTD CM $287,792 against budget CM $396,630.
  - CIN (combined): YTD vs Budget -$73,203; YTD CM $408,492.6.
  - TBJ: YTD vs Budget +$23,237; YTD CM $499,246.
  - TBR: YTD vs Budget +$28,531; YTD CM $594,749.75.
- **2025 per-meal price reference (ABR OneSheeter, distinct from 2026 SC projection):** ABR captures 2025 list and post-SF prices per account. The SC projection prices are the 2026-escalated versions. The relationship is internally consistent and shows the expected YoY escalation under each contract's escalation clause.
- **Contract Type labeling in ABR OneSheeter:** ABR uses "P&L" for TXR, CIN, TBR (3 accounts) and "Select" / blank for TBJ. The "P&L" label correlates with `actuals_drive_invoice` accounts (variable-margin) and the missing/blank label sits on TBJ (which is actually `actuals_drive_invoice` hybrid). Not in conflict with billing_model but a different lens (financial accounting vs invoice generation).
- **STL excluded from ABR 2025.** No St. Louis Cardinals tab in the OneSheeter; no STL section in the Deeper Dive. Likely because flat-fee + cost-reimbursable accounts run a different review track. Worth confirming with Kevin whether STL has its own review process.

### Contradictions flagged

Three distinct contradictions between the ABR documents (or contracts) and the source-of-truth context:

1. **STL - MO 2026 Annual Service Fee figure** (see Open question 8). Source-of-truth says $489,431; contract totals $698,000. [RESOLVED - see `pricing-summit/accounts/ACCOUNT_STL-MO.md`: 2026 escalated actual = $489,497, base $473K.]
2. **TBR - FL MiLB Service Fee continuation past 2024** (see Open question 17). Contract reads one-time; ABR implies annual recurrence. [RESOLVED - see `pricing-summit/accounts/ACCOUNT_TBR-FL.md`: SF is recurring ($200K + variable), not a one-time 2024 front-load.]
3. **TXR - TX - H "annual renewal *the push here would be to try and convert to a fee model"** (ABR PDF p4) - but TXR - TX - H IS already a flat-fee model. The ABR language likely refers to converting TXR - AZ (Surprise) to a fee model, not TXR - TX - H. Tag for Kevin to confirm interpretation. [CONTRADICTION - confirm with Kevin]

## Notes on this document

- Source-of-truth date: 2026-06-16
- Source files: contracts in `/Users/kevinfietek/Documents/Claude /Service Calendars/drive-download-20260615T205813Z-3-001/`
- Discovery docs:
  - `docs/SC_CONTRACT_BILLING_SUMMARY.md` (full contract analysis, 603 lines)
  - `docs/archive/SC_PRICE_COMPARISON.md` (projection vs actuals price audit, 188 lines; archived 2026-07-17)
  - `docs/SC_SPREADSHEET_MAPPING.md` (per-file spreadsheet layout, 1110 lines)
- ABR 2025 inputs:
  - `/Users/kevinfietek/Downloads/ABR Deeper Dive - 2025.pdf` (19 pages; per-account narrative including risk assessments and "3 questions to ask")
  - `/Users/kevinfietek/Downloads/ABR 2025 OneSheeter.xlsx` (5 tabs: Master Template, TEXAS RANGERS, CINCINNATI REDS, TORONTO BLUE JAYS, TAMPA BAY RAYS - no STL tab)
- Postgres source: `accounts.billing_model`, `sc_services`, `sc_service_prices`
- This is a living document. Update as contracts renew (chronological renewal list in the Cross-account section above), pricing changes (CPI annual adjustments per each account's escalation clause), and ABR cycles surface new client asks or scope changes.
