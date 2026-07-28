# SC Account-Knowledge Audit - Read-only Investigation

**Date:** 2026-07-28
**Branch:** `docs/sc-account-knowledge-audit` (own docs-only branch, does NOT touch PR #531)
**Base commit:** `69492c6` (origin/main at fetch time)
**DB:** Supabase production. All queries at manager scope (`allowed_levels = ["unrestricted","restricted"]`).
**Snapshot timestamp:** 2026-07-28T ~15:00Z
**Motivation:** three semantic flags surfaced by PR #531 flag 1 (STL-FL flat-fee contract vs per-meal SC entry), flag 2 (does per-meal + service-fee classify as hybrid or per-meal), and flag 3 (CIN-OH 2026 figure). Kevin's position: the SC build migrated this knowledge into OPD markdown; check whether the answers are already documented before he rules from memory.

## Bottom line

**All three flag questions are documented.** REF-140 (Money Model) is the canonical billing-taxonomy spec and classifies every account. REF-141 (Price Book, generated) restates each account's money shape with 2026 figures matching PG. REC-101..111 carry per-account rulings including the CIN-OH escalation migration and the CIN-AZ SF% classification.

Q1 (taxonomy) verdict: **DOCUMENTED.** REF-140 defines four billing shapes and classifies every account into one.
Q2 (STL-FL) verdict: **INTENTIONAL-AND-DOCUMENTED.** REF-140 §Per-topic model (g) explicitly explains flat_fee + per-meal-SC-entry as one design.
Q3 (CIN-OH) verdict: **DOCUMENTED.** REF-124 states the $362,500 base verbatim; REF-141 and REC-103 restate it as escalated to $376,686 for 2026; PG `sc_fee_schedule` carries $376,686 exactly.

Cross-document consistency sweep found **6 findings** across the corpus - most are staleness or definition-mismatch nits, one is a real number-of-record contradiction (TBJ-FL SF).

The named SC-migrated docs (ACCOUNT-SERVICES-BRIEF, BILLING-MODEL-QUICK-REFERENCE, ACCOUNT-SERVICE-CONFIGURATION, SERVICE-CALENDAR-DATA-ENTRY, CONTRACT-RENEWAL-CALENDAR) **do not exist in the corpus** by any of those titles. The taxonomy content is spread across REF-140 + REF-141 + the 11 REC records. This absence itself is a finding.

## 1. Doc-set inventory (with access tiers) `[ran]`

### Named docs (explicit ids)

Every explicit id resolves; every one is Live and non-archived.

| ID | doc_class | access | Title |
|---|---|---|---|
| REF-121 | REF | unrestricted | Contract Digest - BGC (Boys & Girls Club, second client on TBR-FL) |
| REF-122 | REF | unrestricted | Contract Digest - CIN-AZ (Cincinnati Reds, Goodyear AZ) |
| REF-123 | REF | unrestricted | Contract Digest - CIN-KY (Louisville Bats) |
| REF-124 | REF | unrestricted | Contract Digest - CIN-OH (Cincinnati Reds MLB) |
| REF-125 | REF | unrestricted | Contract Digest - STL-FL (Cardinals, Jupiter FL) |
| REF-126 | REF | unrestricted | Contract Digest - STL-MO (Cardinals MLB) |
| REF-127 | REF | unrestricted | Contract Digest - TBJ-FL (Blue Jays, Dunedin FL) |
| REF-128 | REF | unrestricted | Contract Digest - TBJ-NY (Buffalo Bisons) |
| REF-129 | REF | unrestricted | Contract Digest - TBR-FL (Rays, commissary PDC) |
| REF-130 | REF | unrestricted | Contract Digest - TXR-AZ (Rangers, Surprise AZ) |
| REF-131 | REF | unrestricted | Contract Digest - TXR-TX-H (Rangers MLB home) |
| REF-132 | REF | unrestricted | Contract Digest - TXR-TX-V (Rangers visiting-team) |
| REF-140 | REF | unrestricted | Money Model - Service Calendar Billing Mechanics |
| REF-141 | REF | unrestricted | Price Book - Live Account Pricing (generated) |
| REC-101..111 | REC | **restricted** | Account Record - <account key> (11 records) |
| PB-009 | PB | unrestricted | Financial Operations Manual |

### Named SC-migrated docs: title search `[ran]`

**None of the five named SC-migrated docs exist in the corpus by any of those titles.**

Searched for: `ACCOUNT-SERVICES-BRIEF`, `Account Services Brief`, `BILLING-MODEL-QUICK-REFERENCE`, `Billing Model Quick Reference`, `ACCOUNT-SERVICE-CONFIGURATION`, `Account Service Configuration`, `SERVICE-CALENDAR-DATA-ENTRY`, `Service Calendar Data Entry`, `CONTRACT-RENEWAL-CALENDAR`, `Contract Renewal Calendar`. Zero hits (case-insensitive).

Also searched content for the phrase `billing model` across all `document_chunks`: **zero chunks** contain that literal phrase. The corpus uses `money shape` (in REF-140, REF-141, REC-104..111) and `billing_model` as a PG column name (in REC-101..111 crosswalks).

REC-101 references `ACCOUNT_SERVICES_BRIEF` in an inline citation (`*ACCOUNT_SERVICES_BRIEF, med*` at REC-101 chunk 3), and REF-140 references `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md` (repo-side path) as its per-account source. These are repo-side markdown files, **not loaded into the OPD corpus.**

**Verdict on named set: ABSENT.** If Kevin expected these five docs to answer questions, they're either repo-side only or never got a corpus-load.

### Related unrestricted docs surfaced by content search `[ran]`

| ID | access | Status | Note |
|---|---|---|---|
| STD-002 | restricted | Live | "hybrid" mentions are unrelated (visual severity treatment) |
| PB-010 | unrestricted | Live | "hybrid" mention unrelated (recipe management) |
| PB-005 | unrestricted | In Build | SLA OS Handbook - not yet Live, so absent from the LIVE surface |

None of these carry billing-model taxonomy content.

## 2. Question 1 - the billing-model taxonomy (flag 2)

### 2.1 Definition (Q1.1)

**Verdict: DOCUMENTED.** REF-140 (Money Model, unrestricted) is the canonical taxonomy spec.

Verbatim from REF-140 chunk 6, section "Per-topic model > (c) Invoicing - the client's invoice math per account shape":

> Four account shapes. The model for each:
> | Shape | Accounts | Per-meal invoice line (bi-weekly / weekly) | Service Fee line (separate) | Passthrough |
> |---|---|---|---|---|
> | **SF% (per-meal + SF discounts per-meal)** | CIN-AZ (30%), TXR-AZ (20%), TBR-FL MiLB (25%) | `actual_count × post-SF invoice rate` | Yes, flat annual on separate schedule (CIN-AZ $402,016 Feb+Mar; TXR-AZ 20% deposit Jan/Feb/Mar; TBR-FL front-loaded 2024) | None inside these accounts |
> | **Flat-SF (per-meal + SF independent)** | TBJ-FL ($452,812/yr) | `actual_count × post-SF invoice rate` (= sticker; no discount) | Yes, flat annual on separate schedule (Jan/Feb/Mar split per ABR OneSheeter) | None |
> | **No-SF (pure per-meal)** | CIN-KY, TBJ-NY | `actual_count × post-SF invoice rate` (= sticker; no discount, no SF) | None | None |
> | **Flat_fee** | CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V | **Not per-meal.** Contracted flat fee via `sc_fee_schedule` | The flat fee IS the money | Yes on some accounts (see topic (h)) |

Terminology (REF-140 chunk 3):

> - **Sticker rate.** The workbook projection-tab price. Historical planning number. NOT the invoice. Reference-only.
> - **Post-SF invoice rate.** The workbook actuals-tab price. What the client is billed per meal on the per-meal invoice line. For SF% accounts this equals `sticker × (1 - SF%)`; for flat-SF, no-SF, and flat_fee-tracking accounts, sticker equals post-SF (the two rates are the same number). This is the ONE per-meal-price concept the app displays.
> - **Service Fee (SF).** A separate contracted amount billed alongside per-meal (SF% accounts and flat-SF accounts) or in place of per-meal (flat_fee accounts). Paid on its own schedule per contract; typically flat annual.

REF-141 uses a related but non-identical vocabulary. Per-account "Money shape" strings observed:

- `actuals_drive_invoice (per-meal count x post-SF rate = invoice; SF billed separately)` - CIN-AZ, CIN-KY, TBJ-NY (with variants)
- `actuals_drive_invoice + flat SF (per-meal invoiced weekly, SF billed on its own schedule)` - TBJ-FL
- `actuals_drive_invoice + 20% deposit-triggered discount (billed = full x 0.80)` - TXR-AZ
- `actuals_drive_invoice on both MLB and MiLB sides (separate cost centers). Boys & Girls Club runs as a second-client stream on the same commissary.` - TBR-FL
- `flat_fee (fee IS the money; per-meal rows are operational counts only, $0 billing)` - CIN-OH, STL-MO, TXR-TX-H
- `flat_fee, fee-no-dollar variant (per-meal rows $0 by design; SC displays operational counts)` - STL-FL
- `operational-only (no billing prices by design; fee-schedule $0 marker)` - TXR-TX-V

PB-009 (Financial Operations Manual) uses a DIFFERENT lens entirely: "The Two Financial Models" - `Fee model` (client owns food cost, KitchFix paid management fee) vs `Full-service model` (KitchFix buys food, single all-inclusive fee). This is about **who owns food-cost risk**, not about per-meal invoice mechanics. PB-009 chunk 1 explicitly defers down:

> "the money-model mechanics live in REF-140 (Money Model), and each account's specifics live in its Account Record (REC-101 through REC-111) and Contract Digest. This hub defers to REF-140 for money-model mechanics and does not independently restate money-model figures; live prices resolve from the Price Book."

### 2.2 Classification (Q1.2)

**Verdict: DOCUMENTED.** Every account is placed in REF-140 §(c) and §(d). CIN-AZ and TBJ-FL are in DIFFERENT categories - the agent's B1 answer had a real basis for grouping them apart, but used loose "hybrid/per-meal" labels instead of the canonical SF% / Flat-SF distinction.

**CIN-AZ classification (verbatim across sources):**

- **REF-140 §(c):** SF% (per-meal + SF discounts per-meal), 30%.
- **REF-140 §(d):** "Percentage-based SF (discounts per-meal), CIN-AZ 30%, ... CIN-AZ $402,016 ... Flat annual, separate schedule; per-meal invoice arrives at the discounted rate."
- **REF-141 CIN-AZ header:** "**Money shape:** actuals_drive_invoice (per-meal count x post-SF rate = invoice; SF billed separately). **2026 Service Fee / deposit:** Service Fee **$445,716** (2026 accrued; 2023 base $402,016 = 30% of pre-tax budget). Billed 75% Feb 1 / 25% Mar 15. **Notes:** MLB rates carry a 30% SF discount (billed = full x 0.70)."
- **REC-101 chunk 3 (CIN-AZ Operations Record):** "If it lands, CIN-AZ's shape would change **from SF%-hybrid to flat_fee** (MONEY_MODEL + this file would need updating)."
- **PG `accounts.billing_model`:** `actuals_drive_invoice`.

REC-101 uses the label **"SF%-hybrid"** for CIN-AZ - a shorthand for the REF-140 "SF% (per-meal + SF discounts per-meal)" shape. So CIN-AZ *is* the hybrid one by that internal vocabulary, and REF-140's canonical label is "SF%".

**TBJ-FL classification (verbatim across sources):**

- **REF-140 §(c):** Flat-SF (per-meal + SF independent), $452,812/yr.
- **REF-140 §(d):** "Flat SF (independent of per-meal), TBJ-FL $452,812/yr, Flat annual, Split monthly Jan/Feb/Mar per ABR OneSheeter; per-meal invoice runs in parallel at full rate."
- **REF-141 TBJ-FL header:** "**Money shape:** actuals_drive_invoice + flat SF (per-meal invoiced weekly, SF billed on its own schedule). **2026 Service Fee / deposit:** Service Fee **$515,712 negotiated billable** (3x $171,904 Jan/Feb/Mar; contract's $452,812 base is outdated, superseded by finance)."
- **REC-106 §0 (TBJ-FL header):** "**FLAT SF + PER-MEAL, IN PARALLEL, ACROSS TWO GROUPS/LOCATIONS.** TBJ-FL carries a flat annual Service Fee ($515,712 in 2026) AND per-meal billing, split across MLB, FCL (at the PDC), and FSL (Dunedin Single-A, produced at the PDC + delivered to TD Ballpark)."
- **REC-106 chunk 4 (Rulings):** "**SF vs per-meal** - Flat SF + per-meal in PARALLEL - the SF does NOT buy down per-meal rates."
- **PG `accounts.billing_model`:** `actuals_drive_invoice`.

So CIN-AZ = SF% (SF DISCOUNTS the per-meal). TBJ-FL = Flat-SF (SF does NOT discount the per-meal). Both accounts have per-meal AND service-fee components, but the mechanical relationship between the two differs. The B1 agent grouped both under a mix of "hybrid" and "per-meal", but the canonical distinction is documented and specific.

### 2.3 Q1 verdict summary

- Q1.1 definition: **DOCUMENTED** (REF-140 §Per-topic model (c)-(d), REF-141 per-account "Money shape" headers).
- Q1.2 classification: **DOCUMENTED** for every account. CIN-AZ = SF% (SF discounts per-meal). TBJ-FL = Flat-SF (SF and per-meal independent). These are TWO DIFFERENT shapes in REF-140's taxonomy - the B1 answer's inconsistency was a labeling looseness against a documented four-shape taxonomy, not a corpus gap.

## 3. Question 2 - STL-FL (flag 1)

### 3.1 What each doc says about STL-FL's billing model (verbatim)

**REF-125 §B.2 (contract digest):**

> "NOT PRESENT. The Amendment uses a flat annual fee structure; no per-meal rate is stated."

**REF-125 §B.3:**

> "Total Annual Fee: The total annual fee payable to Contractor for the Florida Services is $2,300,000 (the 'Total Annual Fee'), which consists of the following: i. $1,400,000 for the Florida Services, payable in quarterly installments on the following dates: November 1, 2025; February 1, 2026; May 1, 2026; August 1, 2026; ... ii. $900,000 as the budget for the cost of food, packaging, ..."

**REF-140 §Per-topic model (c):**

> "**Flat_fee** | CIN-OH, STL-MO, **STL-FL**, TXR-TX-H, TXR-TX-V | **Not per-meal.** Contracted flat fee via `sc_fee_schedule` | The flat fee IS the money | Yes on some accounts (see topic (h))"

**REF-140 §(g) (STL-FL specific):**

> "**STL-FL prorated allocation:** the $1.4M is spread PHASE-AWARE across the 13 periods per the P&L pattern (P1 $45,553 · P2 $171,367 · P3 $407,375 (peak) · P4 $132,755 · P5-P9 $98,915 each (FCL plateau) · P10 $57,267 · P11 $52,061 · P12 $39,047 · P13 $0). Source: the PFS Service Fees 2026 workbook, Accrual Schedule (finance-owned), verified against the 2026 P&L appendix (repo-side) row R25 (2026-07-17); year total $1,400,000 EXACT."

**REF-141 STL-FL header:**

> "**Money shape:** flat_fee, fee-no-dollar variant (per-meal rows $0 by design; SC displays operational counts). **2026 Service Fee / deposit:** Florida Services Fee **$1,400,000 flat** (quarterly Nov/Feb/May/Aug, 4x $350,000). $900K food budget = passthrough, excluded. SF is tax-EXEMPT (invoice-confirmed). **Escalation:** None (flat annual). Amendment explicitly does NOT extend the STL-MO CPI clause to FL."

**REC-104 chunk 1 (STL-FL Identity & Aliases):**

> "PG `accounts` - team_key `STL - FL` · name 'St Louis Cardinals' · level `PDC` · billing_model `flat_fee` · has_schedule_overlay `true`. PG `sc_fee_schedule` - $1,400,000 (2026-01-01, annual, quarterly cadence). PG `sc_service_prices` - per-meal rows all $0 (zeroed 2026-06-16; flat-fee planning only) - incl. 'Fun Money allocation' ($0, is_non_revenue)."

**PG `sc_fee_schedule` row `[ran]`:** `{"account_key":"STL - FL", "amount":1400000, "effective_date":"2026-01-01", "period_type":"annual", "payment_cadence":"quarterly", "covered_by_account_key":null, "reason":"Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2).", "changed_by":"seed-script"}`

### 3.2 What each doc says about STL-FL's SC entry mode + the flat-fee ↔ per-meal-entry relationship

**REF-140 chunk 10 §Per-topic model (g) "Flat-fee accounts - what the SC tracks vs where their money lives"** carries the explicit rationale, verbatim:

> "For CIN-OH / STL-MO / STL-FL / TXR-TX-H / TXR-TX-V, the operator still enters headcounts into the SC for planning (ordering, labor, waste, future analytics). The DOLLARS come from `sc_fee_schedule`, not from `count × price`. Per-meal prices in `sc_service_prices` are $0 for these accounts (STL-FL zeroed 2026-06-16; others by design). The SC calendar displays operational tracking only for these accounts - no dollar figure on the tile."

And directly:

> "**STL-FL per-meal-display-on-flat-fee rationale:** STL-FL is billing-model `flat_fee` but operationally a PDC (phases, camps, MiLB affiliates). Chefs enter meal counts for planning. The tile SHOULD show meals, not dollars - the calendar's `isFeeAccount && hasHomestandMap` gate correctly falls through to per-meal display (`fee-no-dollar` variant) because STL-FL has no homestand schedule (it's a PDC, not an MLB). Chefs get the operational surface they need; the $1.4M fee lives in `sc_fee_schedule` for the KPI dashboard. Detail in the SC billing-model audit (repo-side)."

**REF-141 STL-FL page carries a companion Fee-account note:**

> "**Fee-account note:** per-meal rows are $0 by design - revenue = the flat/escalated Service Fee (see header above). PG stores the fee in `sc_fee_schedule`, not on per-meal rows."

And "fee-no-dollar variant" in the "Money shape" line explicitly names the UI variant that shows meals but not dollars.

### 3.3 Q2 verdict

**INTENTIONAL-AND-DOCUMENTED.** REF-140 §(g) has the rationale in plain English: STL-FL is billing-model `flat_fee`, but its operational surface (SC entry, planning, ordering, labor, waste) uses per-meal count entry because it's a PDC. Two-layer architecture: SC calendar = per-meal ops layer; `sc_fee_schedule` = contract-revenue layer. Kevin's flag 1 tension is not a contract-vs-engine gap; both layers are correct and intended, and REF-140 names the exact UI gate (`isFeeAccount && hasHomestandMap` -> `fee-no-dollar` variant) that produces the per-meal-display-on-flat-fee behavior.

## 4. Question 3 - CIN-OH escalation

### 4.1 What the SC-migrated docs say

None of the five named SC-migrated docs exist in the corpus (see §1). The de facto SC-migrated content on CIN-OH lives in REF-140, REF-141, and REC-103.

### 4.2 What REF-140 says (verbatim)

REF-140 does NOT restate the 2026 figure directly. It self-flags as stale on CIN-OH: (REC-103 chunk 6 characterizes the state)

> "**Money shape**: the Money Model (REF-140) (flat_fee). NOTE: MONEY_MODEL's fee figure ($362,500 base) is superseded by finance's escalated $376,686 - pending batch-doc-PR annotation."

REF-140 §(g) lists CIN-OH in the flat_fee bucket without stating a 2026 number.

### 4.3 What REF-141 says (verbatim)

REF-141 chunk 5 CIN-OH header, verbatim:

> "**Account:** Cincinnati Reds - Great American Ballpark (MLB)
> **Money shape:** flat_fee (fee IS the money; per-meal rows are operational counts only, $0 billing).
> **2026 Service Fee / deposit:** Service Fee **$376,686** (2026 escalated; base $362,500). 6 monthly Mar-Aug (installments $61,907.08 pre-tax). Fee is tax-TAXABLE at 7.80%.
> **Escalation:** CPI-U Food Away from Home (CUUR0000SEFV), August reset, 1% floor / 4% cap. PG carries the escalated figure (migration 2026-07-16).
> **Notes:** Postseason mechanic: 1/81-of-fee per game = $4,413.58/game if the Reds qualify."

### 4.4 What REC-103 says (verbatim)

REC-103 chunk 1 (Identity & Aliases):

> "PG `sc_fee_schedule` - $362,500 base row (2026-01-01, annual, monthly-6) - **should be updated to carry the escalated $376,686** (Kevin: PG carries the escalated figure, not the base)"

REC-103 chunk 4 (Rulings & Decisions):

> "**Fee figure** - 2026 SF = $376,686 accrued / $371,442.48 billed (finance-confirmed), escalated from $362,500 base.
> **PG carries escalated** - PG `sc_fee_schedule` should carry the **escalated** $376,686, not the $362,500 base. Kevin ruling."

REC-103 chunk 5 (Open Items):

> "**PG fee-schedule migration to escalated** - Kevin ruled PG carries the **escalated** figure. Migration ran 2026-07-16: CIN-OH `sc_fee_schedule` flipped from $362,500 base → $376,686 escalated (changed_by `kf-fee-escalation-2026-07`). Companion STL-MO migration ran same day ($473K → $489,497)."

### 4.5 REF-124 (contract digest, cross-check with the B1 flag-3 grep)

REF-124 §B.4 verbatim (already established in the B1 flag-3 comment on PR #531):

> "For clarity, the **2026 fee will be based off of an initial fee of $362,500** and increased by the percentage change from August 2024 to August 2025 CPI-U."

### 4.6 PG cross-check `[ran]`

`sc_fee_schedule` CIN-OH row:

```json
{"account_key":"CIN - OH","amount":376686,"effective_date":"2026-01-01","period_type":"annual","payment_cadence":"monthly-6","covered_by_account_key":null,"reason":"CPI escalation per contract §2.a: base $362,500 → $376,686 (2026 CPI-U Food Away from Home, Aug 2024→Aug 2025). Finance-confirmed (PFS Service Fees 2026). LEDGER §W.","changed_by":"kf-fee-escalation-2026-07"}
```

### 4.7 Q3 verdict

**DOCUMENTED.** The contract states $362,500 (REF-124 §B.4). The escalated 2026 number is $376,686 - stated in REF-141, REC-103 rulings, and PG. Migration ran 2026-07-16. All four sources cohere: base $362,500, 2026 escalated $376,686, PG carries the escalated. B1 flag 3 STATED verdict holds. REF-140 self-flags stale on this account.

## 5. Question 4 - cross-document consistency table

Column meaning: what does the doc SAY about the account's billing model and 2026 fee/rate figures. If a cell is left blank, that source is silent on that account.

| Entity | REF-12x contract digest | REC record (restricted) | REF-140 taxonomy | REF-141 price book | PG (`accounts`, `sc_fee_schedule`) |
|---|---|---|---|---|---|
| **CIN-AZ** | REF-122: per-meal ($17.88 MLB / $11.35 MiLB / $4.51 snack, 2023 base) + Service Fee via Exhibit B (75%/25% Feb 1/Mar 15) | REC-101: "SF%-hybrid" · 2026 SF $445,716 confirmed | SF% (30%). 2023 CIN-AZ $402,016 | actuals_drive_invoice; 2026 SF $445,716 (2023 base $402,016 = 30% of pre-tax budget); MLB rates carry 30% SF discount (billed = full x 0.70) | `accounts.billing_model = actuals_drive_invoice`; no `sc_fee_schedule` row (SF out-of-band) |
| **CIN-KY** | REF-123: per-meal Type 1 $25.95, Type 2 $8.64, weekly billed; NO service fee 2026 | REC-102: pure per-meal, no SF, no passthrough. Simplest of the 11 | No-SF (pure per-meal) | actuals_drive_invoice; no SF; annual investment ~$186,462 (§4.b) | `actuals_drive_invoice`; no fee row |
| **CIN-OH** | REF-124: NOT PRESENT as per-meal; Services Fee $357,500 (2025) in 7 installments; §B.4 2026 base $362,500, CPI-escalated | REC-103: 2026 SF $376,686 accrued / $371,442.48 billed; SF taxable 7.80%; PG migration ran 2026-07-16 | Flat_fee; base $362,500 self-flagged stale vs escalated $376,686 | flat_fee; 2026 SF $376,686 (base $362,500); 6 monthly Mar-Aug at $61,907.08 pre-tax; tax-TAXABLE 7.80% | `flat_fee`; `sc_fee_schedule` = **$376,686** exactly, monthly-6 |
| **STL-FL** | REF-125: NOT PRESENT as per-meal; Total Annual Fee $2,300,000 = $1,400,000 Florida Services (quarterly) + $900,000 food passthrough | REC-104: flat_fee; $1.4M confirmed; SF non-taxable | Flat_fee; $1.4M phase-aware allocation P1-P13 verbatim | flat_fee (fee-no-dollar variant); $1,400,000 flat quarterly 4x $350,000; $900K passthrough excluded; SF tax-EXEMPT | `flat_fee`; `sc_fee_schedule` = **$1,400,000** exactly, quarterly |
| **STL-MO** | REF-126: regular-season per-meal NOT PRESENT; Annual Fee $698,000 = $423K meal services (6 monthly) + $50K road food + $225K passthrough | REC-105: base $473K → escalated $489,497 (2026 actual); migration ran 2026-07-16 | Flat_fee; base $473K self-flagged stale | flat_fee; $489,497 billed (base $473K); 6 monthly Mar-Aug at $73,249.50; SF non-taxable | `flat_fee`; `sc_fee_schedule` = **$489,497** exactly, monthly-6 |
| **TBJ-FL** | REF-127: per-meal MLB $20.29 / FSL $14.50 / FCL $10.14; Service Fee $452,812/yr | REC-106: **$515,712 finance-confirmed for 2026** ("contract's $452,812 is outdated, superseded by finance") | Flat-SF; TBJ-FL $452,812/yr | actuals_drive_invoice + flat SF; **$515,712 negotiated billable** (contract's $452,812 base is outdated, superseded by finance) | `actuals_drive_invoice`; no `sc_fee_schedule` row (SF out-of-band) |
| **TBJ-NY** | REF-128: 2019 historical SOW; Per-Meal Rate $18.75; regular-season prepayment + installments structure; no separate service fee | REC-107: rate $27.34 invoice-confirmed; no SF; billed through Toronto PDC parent | No-SF (pure per-meal); $27.34 assumption-only, parked in Q6 register | actuals_drive_invoice; $27.34 uniform; no SF | `actuals_drive_invoice`; no fee row |
| **TBR-FL** | REF-129: MLB per-meal $32.98/$36.54 (2024); MiLB per-meal + Service Fee $382,448 (MiLB SOW, 2 installments) | REC-108: MLB $35.63/$39.48 (no SF); MiLB $17.83/$21.68/$20.96 (25% buy-down via SF); MiLB SF $457,768 for 2026 out-of-band | SF% (25% MiLB); TBR-FL front-loaded 2024 $382,448 | actuals_drive_invoice on both MLB and MiLB; 2026 MiLB SF $457,768 ($200K static + $257,768 variable); BGC $6.50/meal tax-exempt | `actuals_drive_invoice`; no fee row |
| **BGC** | REF-121: **$6.50 per Estimated Meal**, prepaid 4-week periods, tax-exempt; term Aug 19 2025 - May 21 2026 | REC-108 §0: "TWO SERVICE LEVELS + A SECOND CLIENT". BGC is IN-SCOPE second client on TBR-FL commissary | Not classified separately (BGC is discussed inside TBR-FL) | Included in TBR-FL price table: "B&G Lunch $6.50 per meal, tax-free" | No `sc_fee_schedule` row (per-meal, prepaid); prices flow via TBR-FL service catalog |
| **TXR-AZ** | REF-130: per-meal $34.85 base or $27.88 after Annual Deposit; Services Fee comprised of Per-Meal Fee + Annual Deposit buys 20% discount | REC-109: 20% deposit discount + 2.5%/yr fixed escalation; 2026 deposit $301,623; not a PG fee cell | SF% (20% deposit); TXR-AZ 20% deposit Jan/Feb/Mar | actuals_drive_invoice + 20% deposit-triggered discount; 2026 deposit $301,623; 2.5%/yr escalation | `actuals_drive_invoice`; no fee row (deposit out-of-band) |
| **TXR-TX-H** | REF-131: NOT PRESENT as per-meal; Services Fee $604,032 in 6 payments Apr-Sep 2026 | REC-110: $604,032 exact; +10% negotiated for 2026 (2024 $528K → 2025 $549,120 +4% → 2026 $604,032 +10%); SF tax-TAXABLE 8.25% | Flat_fee | flat_fee; $604,032 (6x $100,672 Apr-Sep pre-tax); tax-TAXABLE 8.25% | `flat_fee`; `sc_fee_schedule` = **$604,032** exactly, monthly-6 |
| **TXR-TX-V** | REF-132: NOT PRESENT (bundled into TXR-TX-H's Services Fee) | REC-111: "STRUCTURALLY UNIQUE ACCOUNT" - per-team catering (each visiting MLB team = independent client billed directly), NOT flat-fee/per-meal | (implicit) Flat_fee $0 covered-by-H for the carve-in; catering revenue = separate stream not in fee schedule | operational-only (no billing prices; fee-schedule $0 marker); catering direct-sales tracked in Season Tracker | `flat_fee`, `sc_fee_schedule` = **$0** with `covered_by_account_key = "TXR - TX - H"` |

### Consistency findings

**Contradictions (numbered):**

**Finding C-1 (real contradiction).** TBJ-FL 2026 Service Fee: contract vs finance.
- REF-127 (contract): "$452,812 annual Service Fee"
- REF-140: $452,812/yr
- REF-141: "$515,712 negotiated billable (contract's $452,812 base is outdated, superseded by finance)"
- REC-106 (Rulings): "$515,712 for 2026 = the BILLABLE negotiated figure (finance §W). Contract $452,812 = outdated/superseded. NOT an escalation to reconcile."
- **Resolution recorded in-corpus:** REC-106 rules $515,712 is the 2026 billable; contract number is outdated. REF-140 is stale. Anyone reading the contract digest in isolation gets the old number.

**Finding C-2 (self-flagged staleness).** REF-140 vs REF-141/REC-103 on CIN-OH:
- REF-140 uses $362,500 as base and does not carry the 2026 escalated figure
- REF-141 carries $376,686 escalated; REC-103 carries $376,686; PG carries $376,686
- REC-103 provenance says: "MONEY_MODEL's fee figure ($362,500 base) is superseded by finance's escalated $376,686 - pending batch-doc-PR annotation."
- **Recorded gap:** REF-140 needs update; noted as "pending batch-doc-PR annotation" per REC-103.

**Finding C-3 (same class as C-2).** REF-140 vs REF-141/REC-105 on STL-MO:
- REF-140 has base $473K
- REF-141 and REC-105 carry escalated $489,497
- REC-105 provenance: "MONEY_MODEL's $473K figure is the base; superseded for 2026 billing by finance's $489,497 - pending batch-doc-PR annotation."

**Finding C-4 (internal drift within REC-103).** REC-103 chunk 1 (Identity) says PG `sc_fee_schedule` "should be updated to carry the escalated $376,686" - but REC-103 chunk 5 (Open Items) records the migration as done ("Migration ran 2026-07-16"). The Identity summary sentence is stale relative to the Open Items table below it. Cosmetic, not a factual error.

**Finding C-5 (PB-009 stale reference table).** PB-009 chunk 13 (Related Documents) lists REF-140, REC-101..111, REF-121..132 all as **"In build"** status. PG inventory shows all 25 of those are Live. PB-009's reference table needs a status refresh.

**Finding C-6 (naming-convention split, not a contradiction).** REF-140 uses vocabulary "SF% / Flat-SF / No-SF / Flat_fee" (four billing shapes). REF-141 uses "money shape" strings like "actuals_drive_invoice + flat SF" and "flat_fee, fee-no-dollar variant". REC-101 uses "SF%-hybrid" as its own shorthand for CIN-AZ. PB-009 uses "Fee model / Full-service model" from a food-cost-ownership lens. All four vocabularies describe the same underlying reality but do not share labels. Not a contradiction, but a real onboarding-friction surface for anyone trying to match terms across docs.

**Agreements (worth stating):**

- Every 2026 fee amount in PG `sc_fee_schedule` matches REF-141's 2026 figure exactly: CIN-OH $376,686, STL-FL $1,400,000, STL-MO $489,497, TXR-TX-H $604,032, TXR-TX-V $0 covered-by-H.
- REC-101..111 crosswalks to PG columns (`billing_model`, `has_homestand_schedule`, etc.) match the observed PG state everywhere I sampled.
- The B1 flag-3 verdict (CIN-OH $362,500 STATED, not computed) is corroborated across REF-124, REF-141, REC-103, and PG - four independent sources cohere.
- REC-108 documents BGC as an IN-SCOPE second client on TBR-FL. REF-121 exists as its own contract digest at operator-visible tier. B1 Ruling A stands.

## 6. Question 5 - alignment flags

### F1 - The named SC-migrated docs don't exist in the corpus  *(all)*

Five docs Kevin named as the location of this knowledge (ACCOUNT-SERVICES-BRIEF, BILLING-MODEL-QUICK-REFERENCE, ACCOUNT-SERVICE-CONFIGURATION, SERVICE-CALENDAR-DATA-ENTRY, CONTRACT-RENEWAL-CALENDAR) are absent from the OPD corpus. Repo-side markdown references exist (e.g. REC-101 cites `ACCOUNT_SERVICES_BRIEF`, REF-140 cites `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md`), but they weren't loaded. Result: the taxonomy content is spread across REF-140 + REF-141 + REC-101..111, and Sous depends on stitching them together instead of reading one canonical brief. If Kevin wants a single-place answer for a floor-user question "what billing model is STL-FL?", a BILLING-MODEL-QUICK-REFERENCE at operator scope (excerpting REF-140 §(c)/(d) + REF-141 headers) would close the gap. Chat's next-phase eval design should assume the corpus does NOT have this quick-reference until it lands.

### F2 - REF-140 is stale on CIN-OH and STL-MO 2026 fee figures  *(Kevin + Sous)*

REF-140 §(c)/(d) show base-year $362,500 (CIN-OH) and $473K (STL-MO). REC-103 and REC-105 both explicitly note MONEY_MODEL is superseded by finance's escalated $376,686 / $489,497 "pending batch-doc-PR annotation." Every downstream doc (REF-141, PG) has already caught up. If Sous answers a CIN-OH fee question by grounding on REF-140 without cross-checking REF-141, he gets an outdated figure. Same pattern for STL-MO.

### F3 - Naming-vocabulary fragmentation across the taxonomy docs  *(Chat)*

Four different vocabularies for the same underlying billing shapes: SF% / Flat-SF / No-SF / Flat_fee (REF-140) vs actuals_drive_invoice / flat_fee (REF-141 / PG) vs SF%-hybrid / flat_fee (REC-101 shorthand) vs Fee model / Full-service model (PB-009). Chat's Phase E eval design should either normalize the terms in the eval prompts (harder if we want to test how Sous handles the ambiguity) or add a Rosetta-stone paragraph to the agent prompt (adds prompt weight). The B1 spike case 5b "source-selection stochasticity" plausibly has a cousin here: two docs with different vocabulary give the model the same fact under different names, and it picks between them.

### F4 - TBJ-FL contract-vs-finance number tension is real  *(Sous prompt + Kevin)*

REF-127 (contract digest) says TBJ-FL Service Fee is $452,812. REF-141 and REC-106 say the 2026 billable is $515,712. If Sous grounds on the contract digest, he cites the outdated number. REF-141 and REC-106 both explicitly call the contract number "outdated / superseded by finance" - so an agent that reads either of those doesn't get burned. But an agent that grounds primarily on the REF-12x contract digest for account fee questions would. The B2 money-verbatim prompt rule (from PR #531 flag-3 follow-up) already partly addresses this ("dollar figures cited only when stated in retrieved text; derived figures labeled") - but "stated" doesn't distinguish stale from current. A "current" pointer would be finance-confirmed / PG-verified.

### F5 - Access-tier asymmetry - the classification data IS operator-visible  *(all)*

REF-140 (taxonomy) and REF-141 (per-account rates, money shape, escalation) are BOTH unrestricted. REC-101..111 are restricted. So the billing shape and all 2026 dollar figures are already reachable at operator scope - which is exactly what B1 Ruling A codified. If a "Sous knows accounts" question comes in at operator scope, he has everything he needs to answer taxonomy + per-account fee. He does NOT have access to: fee-model-conversion watches (REC-101), the CIN-AZ→flat_fee conversation with Rachel Sharley (REC-101), the "SF description naming - Management Fee vs Service Fee" convention (REC-105), the "STL-FL upkeep-ownership resolved as Cardinals-reimbursed passthrough" ruling (REC-104), or the operational-rollup stakeholder identities. These sit at restricted scope by design and would need to move to unrestricted only if the answer they enable should be operator-facing.

### F6 - PB-009 §Related Documents stale on doc statuses  *(Chat, Sous)*

PB-009 lists REF-140, REC-101..111, REF-121..132 all as "In build". They're Live. Doesn't harm Sous today (he doesn't ground on PB-009's status table), but if a user asked "what's the status of the money model doc?" Sous would say "In build" from PB-009 while PG says Live. Cosmetic staleness.

### F7 - REC-103 internal drift (chunk 1 vs chunk 5)  *(Sous, minor)*

REC-103 Identity summary sentence says PG "should be updated to carry the escalated $376,686"; Open Items table says migration is done. Both are correct in their moment; the Identity paragraph hasn't been swept after Open Items closed. A future doc-integrity check on REC records could catch these ("status in the Identity block matches the latest state below").

### F8 - `sc_service_prices.account_key` does not exist as a column  *(CC, minor)*

Attempting to query fee-account price rows by `account_key` directly failed: `column sc_service_prices.account_key does not exist`. The join is `sc_service_prices.service_id -> sc_services.account_key`. Not an alignment issue, just a schema note - I flag it so a future audit doesn't repeat the mistake. Chat/CC: any Phase E eval that inspects PG prices per-account needs the join.

### F9 - `hybrid` term overloaded outside billing  *(minor)*

"hybrid" appears in STD-002 (color severity treatment) and PB-010 (recipe management) as unrelated uses. Chat's eval-question design should avoid the bare word "hybrid" as a billing-classifier query - "SF%" or "SF-with-discount" or "per-meal + service fee" is less ambiguous.

## 7. Kevin's flag answers already-in-writing? (one paragraph)

**Yes, all three flag answers exist in writing.** REF-140 §Per-topic model (c)/(d) defines the four billing shapes and classifies every account - answering flag 2 taxonomy directly. REF-140 §(g) has the STL-FL flat-fee-billing plus per-meal-SC-entry rationale in plain English - answering flag 1. And REF-141 header + REC-103 chunk 4 + PG `sc_fee_schedule` all cohere with REF-124 §B.4 on the CIN-OH $362,500 base / $376,686 escalated math - answering flag 3. The gaps are: (i) REF-140 is stale on CIN-OH and STL-MO 2026 figures and self-flags so, (ii) TBJ-FL's contract-vs-finance $452,812/$515,712 tension is real but resolved in REC-106 which is restricted, (iii) none of the named SC-migrated quick-reference docs exist in the corpus, so an agent has to stitch across three docs to compose the answer. The corpus knows the answers; whether Sous will reach them cleanly depends on prompt design and eval coverage of the multi-doc-stitching pattern.

## 8. Provenance

- **Commit:** `docs/sc-account-knowledge-audit` branch off `origin/main@69492c6`.
- **DB:** production Supabase (`SUPABASE_URL` in worktree `.env.local`), manager scope on all queries.
- **Timestamp:** 2026-07-28.
- **Method:** two one-shot read-only scripts run against PG (both deleted post-audit). Full raw output stored as `SC_ACCOUNT_KNOWLEDGE_AUDIT_2026-07-28.raw.txt` alongside this doc.

## 9. Completeness map (BUILD_ACCURACY_PROTOCOL.md C2 / C4)

Every numbered item in the CC prompt -> disposition.

### Doc set locate + inventory

- **[met-ran]** Explicit-id inventory of REF-12x, REC-101..111, REF-140, REF-141, PB-009 - all 26 present, tiers recorded (§1).
- **[met-ran]** Title-pattern search for the five named SC-migrated docs - **ABSENT**. Recorded as a finding (§1, F1).
- **[met-ran]** Content-side lowercase-token sweep for SC-family docs - no additional hits.
- **[met-ran]** Content search "billing model" phrase - **zero chunks** in the corpus.

### Question 1 - taxonomy + classification

- **[met-ran]** REF-140 §Per-topic model (c)/(d) verbatim as taxonomy definition (§2.1).
- **[met-ran]** Every account classified verbatim across REF-140/REF-141/REC records (§2.2).
- **[met-ran]** Verdict per sub-question DOCUMENTED (§2.3).

### Question 2 - STL-FL

- **[met-ran]** REF-125, REF-140 §(c)/(g), REF-141, REC-104, PG all quoted verbatim (§3.1, §3.2).
- **[met-ran]** Verdict INTENTIONAL-AND-DOCUMENTED (§3.3).

### Question 3 - CIN-OH escalation

- **[met-ran]** SC-migrated docs check - none exist; REF-140, REF-141, REC-103, REF-124, PG all quoted verbatim (§4.1-4.6).
- **[met-ran]** Verdict DOCUMENTED (§4.7).

### Question 4 - consistency table

- **[met-ran]** 12-entity x 5-source table (§5). 6 findings recorded, 1 real contradiction (TBJ-FL SF), 2 self-flagged staleness, 1 internal drift, 1 stale reference table, 1 naming-vocabulary fragmentation.

### Question 5 - alignment flags

- **[met-ran]** 9 flags recorded (§6), each labeled with audience (Kevin / Chat / Sous / all).

### Deliverables

- **[met-ran]** This audit doc.
- **[met-ran]** Raw log preserved alongside as `SC_ACCOUNT_KNOWLEDGE_AUDIT_2026-07-28.raw.txt`.
- **[met-ran]** Docs-only branch, no code changes; PR to be opened at push.

### gate findings

Not applicable - this is a read-only investigation, not a code PR.
