# Service Calendar - Contract Billing Summary
<!-- ═══════════════════════════════════════════════════════════════════
     RESOLVED BILLING DECISIONS - CONTRACT BIBLE
     Authoritative decision record. Locked 2026-06-18 (Kevin + Chat-Claude,
     from executed contracts). This section is the source of truth; the
     per-account contract extraction below it is the supporting detail.
     When a decision here conflicts with older notes in this doc or in
     SC_BILLING_MODEL_AUDIT.md, THIS SECTION WINS.
     ═══════════════════════════════════════════════════════════════════ -->

# Resolved billing decisions (contract bible)

Locked 2026-06-18 from executed contracts. These supersede any earlier
contradiction in this document, in SC_BILLING_MODEL_AUDIT.md, or in prior chat
notes.

## The architecture: two kinds of revenue, one control surface

KitchFix revenue splits into two kinds, and they live in two different places:

- **Per-meal / operational revenue** = meals served x per-meal price. This is
  the Service Calendar's job. The calendar's revenue numbers come from the
  canonical `sc_daily_revenue` view (effective-dated price x actual count).
- **Contract revenue** = flat fees, service fees, and postseason per-game
  billing. This is the contract-revenue layer. It is managed in the admin
  page and feeds the future KPI dashboard. It is NOT in the Service Calendar.

The admin page is the single control surface. You manage everything there -
per-meal prices AND contract revenue. The Service Calendar and the future KPI
dashboard are two different read-only windows onto that data:

- Service Calendar reads per-meal prices (operational revenue).
- KPI dashboard (future) reads the fee schedule + service fees + postseason
  (contract revenue).

**The Service Calendar does NOT consume fee data.** Fee accounts show
operational meal tracking only - no dollar figure on the calendar. Their money
lives in the contract-revenue layer.

This is the "dashboard owns the data; surfaces consume it" principle: one place
to edit, multiple places to read, clean separation between operational and
contract revenue.

## Passthrough is never revenue

Several contracts include a food/packaging/supplies budget reimbursed at cost.
These are net-zero margin - billed and collected, but paid straight through to
suppliers. **They are excluded from all revenue figures**, everywhere. Counting
them inflates topline. Excluding them is also what collapses every fee account
to a single clean annual number.

Passthrough lines (excluded):
- CIN - OH: food and disposable supplies budget (at cost, Net 30)
- STL - MO: $225,000 food/packaging/supplies budget
- STL - FL: $900,000 food/packaging/supplies budget

## Fee schedule - the contract-revenue layer (Bundle 1)

These are the flat-fee accounts. Revenue = the service/fee portion only,
passthrough excluded. Effective-dated (a CPI bump or renegotiation is a new
dated row, never an overwrite). Managed in the admin; feeds the future KPI
dashboard; the calendar does not show these dollars.

| Account | Category | 2026 revenue (fee) | Structure | Escalator | Notes |
|---|---|---|---|---|---|
| **CIN - OH** | MLB | **$362,500** | 6 monthly installments (Mar-Aug) | CPI-U Food Away from Home, Aug-to-Aug, floor 1% / cap 4% | Food/supplies passthrough excluded. Postseason add-ons deferred. |
| **STL - MO** | MLB | **$473,000** | $423,000 meal services (6 monthly from Mar 1) + $50,000 road food (annual Mar 1) | CPI-U Food Away from Home (CUUR0000SEFV), Aug-to-Aug, no floor/cap | $225K passthrough excluded. The old "$489,431" figure was a CPI-escalated version of this $473K service portion. The "$698K" is the contract gross including passthrough - store $473K. Postseason deferred. |
| **TXR - TX - H** | MLB | **$604,032** | 6 monthly installments (Apr-Sep), ~$100,672 pre-tax each | None (direct 10% YoY; prior year was $549,120) | Single-year 2026 contract. Postseason pro-rata per game, deferred. |
| **TXR - TX - V** | MLB | **$0** (covered by H) | Bundled into TXR - TX - H's $604,032 | n/a | Do NOT bill separately - it would double-count H. Marker: "covered by TXR-TX-H contract." Real visiting-team direct-sales revenue is tracked in Season Tracker (sold revenue x 19.23% labor model), out of scope for the fee schedule. |
| **STL - FL** | PDC (promoted to fee) | **$1,400,000** | Florida Services fee, quarterly installments (Nov 1 / Feb 1 / May 1 / Aug 1) | None stated (co-terminous with STL-MO base) | $900K food passthrough excluded. Upkeep budgets ($15K equipment + $4K storage pod + $11K ST cooler) are KitchFix-borne expense/budget lines, not revenue - excluded. KitchFix is responsible for labor and expenses per the Amendment. 2027 work-stoppage standby fees ($350K full / $175K half) are conditional/date-bounded, track in notes only. |

**STL - FL is promoted to a true fee account.** Its per-meal prices are no
longer tied to the Service Calendar's revenue. It remains a PDC operationally
(operators still enter actuals for ordering/labor/waste - that is an internal
operational matter, not a billing input). For revenue, STL-FL is the $1.4M fee.

## Service fees - contract-revenue layer, LATER stage (not Bundle 1)

These accounts bill a flat service fee ON TOP OF per-meal. The per-meal side is
already in the Service Calendar. The service-fee side needs to be tracked in the
contract-revenue layer alongside the fee schedule - but in a LATER stage, not
Bundle 1. Until then, these accounts' total revenue is understated by the
service-fee amount. Accepted.

| Account | Service fee (annual) | Escalator | Per-meal relationship |
|---|---|---|---|
| **CIN - AZ** | $402,016 (2023 base, = 30% of budget estimate) | CPI-U Food Away from Home, Oct base, floor 2% / cap 5% | **The 30% service fee is why per-meal is billed at the 70% cost basis.** $29.01 MLB x 0.70 = $20.31; $18.42 MiLB x 0.70 = $12.90. The "$29.01 vs $20.31 gap" is NOT a missing amendment - it is this mechanic. (Confirm no separate amendment exists; conversion-to-flat-fee conversation ongoing per ABR 2025, not executed.) |
| **TBJ - FL** | $452,812/yr | CPI Food Away from Home, one increase per year, Provider notice by Jan 31 | Service fee does NOT discount per-meal - both revenue streams run at full rate in parallel. **MFN/favored-pricing clause** (see open items). |
| **TBR - FL (MiLB)** | $382,448 (2024 one-time front-load: $200K on signing + $182,448 by Feb 1 2024) | 75% of CPI Food Away from Home, Nov-to-Nov | MiLB per-meal rates carry a 25% discount "during the Term" to amortize the fee. **Renewal status for 2026 unconfirmed** (see open items). |

## Postseason - deferred to a later stage

If a team makes the playoffs, service continues and KitchFix bills per game at
the contracted rate. Real contract revenue, but conditional and months out -
deferred, not in Bundle 1.

| Account | Postseason game | Postseason workout | Other |
|---|---|---|---|
| CIN - OH | $4,413.58 (1/81 of Services Fee) | $2,206.79 (50% of game) | + CPI |
| STL - MO | $5,222.22 | $2,777.78 | Road Food $600 |
| TXR - TX - H | pro-rata Services Fee per game (~$7,457.93) | - | - |

## Per-meal accounts (Service Calendar, unchanged)

These bill meals x price; the Service Calendar is the billing-relevant surface.
No fee-schedule entry.

- **CIN - KY** (Louisville Bats, AAA): pure per-meal, $25.95 meals / $8.64 snack. Single-season 2026. Note: the $24K prepayment from the DRAFT was REMOVED in the executed contract.
- **TBJ - NY** (Buffalo Bisons, AAA): per-meal assumed, $27.34. **No contract on file** (see open items). Snack/Shake deactivated.
- **TXR - AZ** (Rangers Surprise, PDC): per-meal with a 20% deposit discount (deposit triggers 20% off every per-meal rate). Stored prices are the 80% post-deposit rates. Fixed 2.5%/yr escalation.
- **CIN - AZ, TBJ - FL, TBR - FL**: per-meal in the calendar (their service fees are tracked separately per above).

## Open items (flagged, not blocking Bundle 1)

1. **TBJ - NY (Buffalo Bisons)** - no contract in the package. Per-meal projection ($27.34) is assumption-only. Need a contract or written confirmation of the operating model.
2. **CIN - AZ operative 2026 pricing** - the $20.31/$12.90 stored prices are the 70%-of-budget cost basis under the 30% service-fee mechanic. Confirm no separate 2026 amendment exists beyond the 2023 contract + that mechanic.
3. **MFN / favored-pricing clause (TBJ - FL)** - any per-meal discount given to another account for equivalent-or-lower volume could entitle TBJ-FL to that lower rate. The admin pricing editor has NO awareness of this today. A cross-account MFN warning is a future enhancement, not Bundle 1.
4. **TXR - AZ 2026 SOW** - missing from the package. 2026 deposit amount and new services (Continental Breakfast, MLB Dinner, Extra Protein) are not contractually sourced.
5. **TBR - FL MiLB service-fee renewal** - the $382,448 was a 2024 one-time front-load; whether it recurs in 2026 is unconfirmed.
6. **TBR - FL "B&G" (Boys & Girls Club)** - $6.50/lunch, no written agreement in the package.
7. **TXR - TX - V scope mismatch** - contract scope is Grab & Go + snacks + coffee only; the Service Calendar models full buffet. Mirroring TXR-TX-H is the agreed stopgap; do not treat the SC service list as contractually authorized.
8. **CIN - AZ Exhibit B volume threshold** - reads as MiLB rates DROPPING to $16.22 after 72,890 meals, which is HIGHER than the $11.35 base. Likely a typo or pricing-tier construct in the 2023 doc.

<!-- ═══════════════════════════════════════════════════════════════════
     END RESOLVED DECISIONS. The original per-account contract extraction
     follows below as supporting detail.
     ═══════════════════════════════════════════════════════════════════ -->

---

Cross-account billing analysis from the 11-account Service Calendar portfolio,
built from executed contracts at `/Users/kevinfietek/Documents/Claude /Service Calendars/drive-download-20260615T205813Z-3-001/`
and cross-referenced to spreadsheet projection rates in
[`SC_PRICE_COMPARISON.md`](./SC_PRICE_COMPARISON.md) and layout mapping in
[`SC_SPREADSHEET_MAPPING.md`](./SC_SPREADSHEET_MAPPING.md). Analysis date:
2026-06-15.

Source contracts read (15 documents across 9 folders):

| Account | Primary contract | Extraction |
|---|---|---|
| CIN - AZ | REDS/Reds & Kitchfix Signed Agreement-2023 copy.docx (2023, in-Term through 2025; Reds held renewal options through 2027) | DOCX text |
| CIN - KY | Bats/BATS 2026 Contract DRAFT.docx (text-identical to executed PDF, confirmed via OCR) | DOCX text + OCR cross-check |
| CIN - OH | CINN/2025-26 Reds-KitchFix Food Services Agreement.pdf | OCR (scanned PDF) |
| STL - FL | JUPITER/KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.docx (Amendment to STL base agreement) | DOCX text |
| STL - MO | STL/2025-27 Food Services Agreement St. Louis Cardinals + KitchFix.pdf (base agreement; covers Busch Stadium MLB; Jupiter is an amendment to this) | OCR (scanned PDF) |
| TBJ - FL | TBJ/Complete_with_DocuSign_Final_Dunedin_Caterin - Final.pdf (Services Agreement + Schedule A SOW #1) | pdfplumber text |
| TBJ - NY | (no separate contract found in folder) Buffalo Bisons covered by no document in this drop | n/a |
| TBR - FL | TBR/Services Agreement Major League Foodservice + ML SOW + Services Agreement Minor League Foodservice + MiLB SOW (all 4 PDFs) | pdfplumber text |
| TXR - TX - H | TXR/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf | pdfplumber text |
| TXR - TX - V | TXR/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf (same contract; visitor clubhouse covered as Grab & Go + snacks + coffee only) | pdfplumber text |
| TXR - AZ | TXR-AZ/Texas Rangers 2025-2027 Surprise Food Service Agreement.pdf | pdfplumber text |

Cross-reference / historical (read but not the operative contract for 2026 billing):

- CINN/2025-26 Reds-KitchFix - this is the MLB-only Cincinnati Reds contract (Great American Ballpark), covering CIN - OH; it does NOT cover Goodyear AZ.
- REDS/Reds & Kitchfix Signed Agreement-2023 copy.docx - the Goodyear AZ Initial Term 2023-2025 catering agreement covering CIN - AZ, with Reds-held renewal options through 2027.
- Bats/BATS Contract Executed Final.pdf - 2024 Louisville Bats contract ($24/$8); superseded by 2026 redline.
- Bats/BATS 2025 Contract.pdf - 2025 Louisville Bats contract; superseded by 2026 redline.
- TXR/Texas Rangers 2025 MLB Food Service Contract.pdf - 2025 Rangers MLB ($549,120); superseded by 2026 contract ($604,032).
- TXR-AZ/TXR-AZ - Food Services Agreement - KitchFix (2022).pdf - prior 2021-2024 Surprise AZ agreement; superseded by 2025-2027.

## Per-account contract terms

### CIN - AZ (Cincinnati Reds, Goodyear AZ - PDC spring training)

**Source: REDS/Reds & Kitchfix Signed Agreement-2023 copy.docx ("Catering Services Agreement", Effective January 3, 2023).**

**Billing structure:** Hybrid (annual Service Fee + per-meal Catering Fees).
- Service Fee 2023 = $402,016 (calculated at 30% of pre-tax budget estimate of $1,340,056). Section IV(B).
- Per-meal Catering Fees billed on top of Service Fee for each meal served.

**Payment schedule:**
- Service Fee: 75% due February 1, remaining 25% due March 15 each year. Section IV(B)(1).
- Catering Fees: invoiced every 15 days (bi-monthly) in arrears, Net 30. Section V(B), V(C).

**Deposit / prepayment:** No standalone deposit; the 75% Feb-1 installment of the Service Fee functions as front-loaded payment. No discount tied to deposit.

**Net payment terms:** Net 30 on catering invoices. Section V(C).

**Per-meal rates (2023 base):**

| Service | 2023 rate (contract) | Notes |
|---|---|---|
| MLB Breakfast | $17.88 / person | Spring training only. Section IV(B)(1) |
| MLB Lunch | $17.88 / person | |
| MLB Dinner | $17.88 / person | |
| MiLB Breakfast | $11.35 / person | Section IV(B)(2) |
| MiLB Lunch | $11.35 / person | |
| MiLB Dinner | $11.35 / person | |
| MiLB Snack | $4.51 / person | |
| Late Night option | $12.77 or = Dinner rate | If 2 meals > 8 hr apart, $12.77; else = Dinner |
| Coffee Service | $450 / week | Optional, tax-free, max 45 weeks/year |
| Fountain Beverages | $250 / week | Optional, tax-free, max 45 weeks/year |
| Cooking demo | $1,000 / class | Educational services rider |

Volume threshold (Exhibit B): once 72,890 meals are billed in 2023, MiLB rates drop to $16.22 (Breakfast/Lunch/Dinner) and $6.44 (Snack). Note this is HIGHER than the base $11.35 - reads as a non-discounted post-cap rate (likely a typo or pricing-tier construct; flag for Kevin).

**Escalation clause:** CPI-U Food Away from Home (October base). Floor 2%, cap 5%. Annual increase starting 2024. Section IV(B)(3).

**Calculated 2026 rate (estimated, exact CPI per-year not modeled here; base $11.35 MiLB Breakfast):** Three years of escalation at the floor (2%/yr) = $11.35 * 1.0612 = $12.04; at the cap (5%/yr) = $11.35 * 1.1576 = $13.14. Spreadsheet projection is $18.42 for MiLB Breakfast - significantly above either CPI-bound. Likely indicates either contract renegotiation outside the 2023 doc or pricing decoupled from the 2023 contract.

**Contract vs spreadsheet rate gap (CIN - AZ MLB Breakfast):**
- 2023 contract base: $17.88
- 2026 spreadsheet projection: $29.01
- Spreadsheet actuals (cost basis): $20.31
- This is a 62% gap above the 2023 base + max CPI - **the operative 2026 pricing is not in the 2023 document on file**.

**Term and scope:**
- Initial Term: January 1, 2023 - December 31, 2025. Section I(A).
- Renewal Terms: two consecutive 12-month periods (2026 + 2027) at Club's option. Notice by Nov 1 of prior year. Section I(B).
- Termination for cause: 15-day cure. Section I(C).
- Scope: ML Spring Training (Feb-Mar), MiLB Early Camp (Jan-Feb), MiLB ST (Mar-Apr), Extended ST + Arizona Summer League (Apr-Aug), Fall Instructional League (Aug-Oct), First Year Player Camp (Oct-Nov), Rehab year-round. Section I(D).
- Personnel served: ~115 MLB; ~75-90 MiLB Early; ~240 MiLB ST; ~82 Extended; ~70 ASL; ~73 Fall Instructs; ~60 First Year.

**Special provisions:**
- Force Majeure: Club may suspend the Agreement; during suspension, no obligations on either side. Service Fee initial installment (75%) is not refundable on FM; remaining fees prorated by `days not served / 240`. Section VII(B), IV(F).
- Educational services (cooking classes) billed at $1,000/class.

### CIN - KY (Louisville Bats - AAA)

**Source: Bats/BATS 2026 Contract DRAFT.docx (text-identical to the executed Bats/KitchFix_2026LouisvilleAgreement_4.22.26.pdf, confirmed via OCR; effective Apr 21, 2026, "Effective Date" in Section 1 of executed PDF).**

**Billing structure:** Per-meal only (no flat fee). Two per-meal tiers.

**Payment schedule:**
- Weekly invoicing for the prior week's homestand meals. Section 3(a) / 4(a) executed.
- Net terms: not stated explicitly in the 2026 executed; the prior 2024/2025 contracts also used weekly billing.

**Deposit / prepayment:** **None in 2026 executed contract.** The 2026 DRAFT included a $24,000 lump-sum prepayment with a $2,000-per-homestand credit (12 homestands), but this clause was **removed in the executed Apr-21-2026 contract** - flag for Kevin since the operational behavior changed and the DRAFT may have been used as the basis for service-calendar projection assumptions.

**Per-meal rates (2026 contract):**

| Service | Contract rate | Spreadsheet projection | Match? |
|---|---|---|---|
| Breakfast | $25.95 | $25.95 | YES |
| Lunch | $25.95 | $25.95 | YES |
| Post-Game | $25.95 | $25.95 | YES |
| Umpire | $25.95 | $25.95 | YES |
| Snack | $8.64 | $8.64 | YES |

Estimated 2026 annual investment: $186,462 + tax. Section 4(b) executed.

**Escalation:** None stated for 2026 (single-year contract). Material changes to Exhibit A SOP trigger good-faith renegotiation. Section 4(b) DRAFT / Section 5 executed.

**Term and scope:**
- Effective Date - December 31, 2026. Single-season contract. Section 2(a).
- Scope: Exclusive caterer for Bats at Louisville Slugger Field. Arrival + mini-meal for full season. Section 1.
- Post-game service deferred: parties will discuss expanding into post-game service at the start of May after observing first two homestands in co-used kitchen. Section 5(a)(ii) executed - this is operationally material because the SC projections include Post-Game meals from opening day, not May onward.
- Minimum meals: 11 buffet meals per standard 6-game homestand guarantee.

**Special provisions:**
- **72-hour outside-catering clause:** Club must give 72 hours notice for outside catering (MLB rehab dinners, etc.). Less notice = KitchFix may seek compensation for lost product. Section 4(a) DRAFT / Section 5(a)(v-vi) executed. (This is the clause Kevin flagged.)
- Force Majeure: Club may suspend; payment obligations also suspended. Lump-sum credit was refundable upon FM in DRAFT; clause moot in executed because the lump sum was removed. Section 2(b)(iii).
- Termination: 30-day notice for-any-reason by Club; pro-rata Services Fee due through notice period (executed only).

### CIN - OH (Cincinnati Reds MLB, Great American Ballpark)

**Source: CINN/2025-26 Reds-KitchFix Food Services Agreement.pdf (signed Nov 22, 2024).**

**Billing structure:** Hybrid (flat Services Fee + reimbursed Food/Supplies + reimbursed Clubhouse Extras).

**Payment schedule (2025 season):**
- Services Fee = $357,500. Seven installments. Section 2(a):
  - $56,250 on Mar 1, Apr 1, May 1, Jun 1, Jul 1, Aug 1, 2025.
  - $20,000 on Jan 1, 2027 (year-end true-up / postseason holdback).
- Food and Disposable Supplies: invoiced after each homestand, Net 30. Section 2(b), 2(d).
- Clubhouse Extras (grab-and-go, packaged snacks, hot coffee/tea, cold-pressed juices, kombucha, outside catering): reimbursed at cost, invoiced after each homestand, Net 30. Section 2(c), 2(d).

**2026 Services Fee:** Determined by CPI-U Food Away from Home (August to August), floor 1%, cap 4%. Base for 2026 = $362,500 + escalation. **Six** consecutive monthly installments March 1 through August 1, 2026. Section 2(a).

**Per-meal rate (implied from spreadsheet, not stated in contract):** Contract is flat-fee. Spreadsheet shows $25.95 per meal for Arrival / Post BP / Post-Game / Umpire. With ~81 games x ~3 meals x ~50 people = ~12,150 meals/year, $362,500 / 12,150 ≈ $29.84/meal - **higher than the $25.95 spreadsheet rate**. Implies the $25.95 projection rate is being applied for the sake of the SC tool but the actual billing is the flat fee, and the per-meal rate is derived for projection-tracking purposes only.

**Net payment terms:** Net 30 on cost reimbursement; installment schedule for Services Fee.

**Term and scope:**
- Effective Date - end of 2026 MLB season. Section 3(a).
- 2027 extension option: Reds notify by Oct 1, 2026; otherwise good-faith meet-and-confer by Nov 1, 2026. Section 3(a).
- Scope: 3 meals/game for up to 75 people, ~81 regular season games + up to 2 exhibition + postseason if Reds qualify. Section 1(a)(b).
- Postseason: Post Season Game Rate = $4,413.58 (1/81 of Services Fee); Post Season Workout Day Rate = $2,206.79 (50% of Game Rate). Plus CPI escalation. Section 2(e).

**Termination:** 10-day cure for material breach; Reds can terminate at-will with 30 days notice + pro-rata Services Fee. Reds prepayment refunded within 5 business days. Section 3(b).

**Special provisions:**
- Force Majeure: Reds may suspend if FM causes cancellation, postponement, or Capacity Restrictions. During suspension, no obligations on either side. Section 12.
- MLB subservience: standard MLB rules-supremacy clause.

### STL - FL (St. Louis Cardinals - Jupiter PDC)

**Source: JUPITER/KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.docx (Amendment to base STL - MO agreement, dated Nov 26, 2024; Amendment effective Oct 3, 2025).**

**Billing structure:** Pure flat fee. Total Annual Fee = $2,300,000.

**Payment schedule:** Section 2(a)(i)-(ii).
- $1,400,000 for Florida Services in **quarterly installments** on Nov 1 (2025), Feb 1, May 1, Aug 1 (2026), and one in 2027 per work-stoppage section.
- $900,000 budget for food, packaging, supplies - invoiced **bi-monthly** (every 15 days) with receipts; Contractor not responsible for hitting budget cap; savings revert to Cardinals; cost overruns billable. Section 2(a)(ii).
- Plus annual upkeep: $15K equipment/repair budget (rolls over), $4K storage pod, $11K temporary cooler (ST only) + electrical. Section 2(b).

**Deposit / prepayment:** Quarterly installments are de facto prepayment - first installment Nov 1, 2025 is paid 3+ months ahead of ST season start.

**Net payment terms:** Bi-monthly invoicing for food/supplies budget; quarterly fixed.

**Per-meal rates (none stated):** Contract is flat fee. Spreadsheet projection of $26 (MiLB) and $40 (ST) is derived for the SC tool and does not directly correspond to contract per-meal rate.

**Term and scope:**
- Florida Services run alongside the base Cardinals Agreement (effective Jan 1, 2025 - Dec 31, 2027). Amendment is co-terminous.
- Florida scope: PDC at Roger Dean Chevrolet Stadium, Jupiter, FL. MLB ST, MiLB ST, Palm Beach Cardinals (MiLB regular season).
- Standard portion sizes: 10 oz protein / 6 oz starch / 6 oz vegetables. Spring training elevated to grass-fed beef, wild-caught seafood, free-range poultry, pasture-raised eggs. Section 1 SLA.

**Special provisions:**
- **2027 work-stoppage clause:** First quarterly installment ($350K + tax) due Nov 1, 2026 is **earned in full** even if Florida Services don't happen Jan 1-Mar 31, 2027 due to MLB work stoppage. Section 2(c).
- **Standby installment:** If work stoppage continues past Mar 31, 2027, 50% of Q2 installment ($175K + tax) is due Apr 1, 2027; if any Florida Services resume after Mar 31, full Q2 installment ($350K) due with equitable adjustment for reduced MLB headcount.
- **June 30, 2027 stop-loss:** If work stoppage continues beyond June 30, parties meet and confer to determine equitable arrangement; neither party obligated to perform / pay after Nov 19, 2027 unless newly agreed.
- Termination for convenience: 180 days notice; can terminate just Florida Services without terminating full Agreement. Section 3(a)(ii).
- Kitchen facility responsibility: Cardinals are responsible if their new facility isn't completed on time. Section 1(b).
- Force Majeure: standard suspension; CDC/WHO outbreaks, work stoppages enumerated. Section 6.

### STL - MO (St. Louis Cardinals MLB - Busch Stadium)

**Source: STL/2025-27 Food Services Agreement St. Louis Cardinals + KitchFix.pdf (signed Nov 26, 2024; Effective Jan 1, 2025).**

**Billing structure:** Pure flat annual fee. Total Annual Service Fee = $698,000 per year.

**Payment schedule:**
- Home Games Hospitality Management: $423,000 in 6 monthly installments starting Mar 1 each year (2025/2026/2027). Section 2(a)(i).
- Road Food Management: $50,000/year due Mar 1 each year. Section 2(a)(ii).
- Food, packaging, supplies budget: $225,000/year; monthly budget updates (not bi-monthly like Jupiter). Section 2(a)(iii).
- Plus $60K equipment investment by Contractor over the Term, becomes Cardinals property. Section 2(e)(i).

**Deposit / prepayment:** No standalone deposit; first installment Mar 1 acts as front-loaded.

**Per-meal rates (none stated):** Contract is flat fee. Spreadsheet $25.95 is derived (matches CIN - OH and other MLB clubhouse standard rate but not contractually billed per-meal).

**Postseason rates:**
- Post Season Game: $5,222.22
- Post Season Workout Day: $2,777.78
- Road Food Management postseason: $600
- All subject to CPI adjustment described below. Section 2(b).

**Escalation:** 2026 and 2027 pricing adjusts by CPI-U Food Away from Home (CUUR0000SEFV), based on August prior-year report. No floor/cap stated for STL. Section 2(d)(i)-(ii).

**Term and scope:**
- Term: Effective Date Jan 1, 2025 through Dec 31, 2027. Section 3(a).
- Scope: home games (~81) + up to 6 workout dates at Busch Stadium; up to 70 individuals per meal; 6 road series with on-site catering coordination. Section 1(a)(b).

**Termination for convenience:**
- 90 days notice + termination fee: $60K if in 2025, $40K if in 2026, $20K if in 2027. Section 3(b)(ii).
- 30-day cure for material breach.

**Special provisions:**
- Registered Dietitian provided at Contractor cost; on-site up to 20 days/year. Exhibit 2.
- Road games: Contractor coordinates 6 road series on-site/in-person each season; Cardinals pay all road catering expenses; Contractor budget-tracks if budget provided.
- MLB subservience: full standard MLB clause. Section 9.

### TBJ - FL (Toronto Blue Jays - Dunedin PDC)

**Source: TBJ/Complete_with_DocuSign_Final_Dunedin_Caterin - Final.pdf (Master Services Agreement + Schedule A SOW #1 - Dunedin FL Food and Beverage Services, Effective Apr 5, 2023).**

**Billing structure:** Hybrid (annual Service Fee + per-meal Meal Fees + per-snack + per-shake).

**Payment schedule:**
- Service Fee: $452,812/year, paid annually per SOW #1 Section 12(a) (exact installment cadence not specified - likely annual or per Section 12 reconciliation).
- Meal Fees + Snacks + Shakes: weekly invoicing within 5 days of week end, Calendar Week = Mon-Sun. Section 12(e). Net 30 standard implied.

**Deposit / prepayment:** None stated.

**Per-meal rates (2023 contract):**

| Service | Contract rate (2023) | Spreadsheet projection | Match? |
|---|---|---|---|
| MLB Player Meal | $20.29 | $23.12 (Breakfast/Lunch/Dinner/Umpire/Post Game) | NO - spreadsheet is ~14% higher; reflects CPI escalation through 2026 |
| FSL Team Meal (Florida State League MiLB Single-A) | $14.50 | $16.51 (Single A Jays Breakfast/Pre-Game/Post-Game) | NO - ~14% higher; CPI |
| FCL Team Meal (Florida Complex League MiLB) | $10.14 | $11.55 (Minor League PDC Breakfast/Lunch/Dinner) | NO - ~14% higher; CPI |
| Snack | $1.50 | $1.70 (MLB G&G Pantry, MiLB G&G Pantry, MLB Snack) | NO - ~13% higher; CPI |
| Shake | $5.00 | not in spreadsheet | n/a |

The ~14% projection-vs-contract gap is internally consistent across all per-meal services and matches a CPI Food Away from Home cumulative escalation 2023-2026 (~14-15%). Section 12(c) permits one increase per Agreement Year capped at the CPI change from Q4 prior year. The 2026 rates appear to be properly escalated from the 2023 base.

**Stadium Staff Meals ($16.51), Media Meals ($16), MLB Catering ($38), Team Canada ($11.55), Fun $$$$ Allocated ($28,472.76):** Not in the 2023 SOW #1 base list. These are either later-added services or were folded into a price-increase notification. Flag for Kevin to confirm whether an amendment SOW #2 exists that defines them.

**Escalation:** CPI Food Away From Home; one increase per Agreement Year; Provider must send notice by Jan 31; Club approval not to be unreasonably withheld. Section 12(c).

**Term and scope:**
- Initial Term: Feb 1, 2023 - Jan 31, 2026. Section 5(a).
- Renewal: auto-renews for up to three additional 1-year periods; Club may decline with 45 days notice prior to renewal date. Section 5(a).
- **As of the analysis date (2026-06-15), this contract is in Renewal Term Year 1.**
- Scope: Dunedin FL TD Ballpark + 3031 Garrison Road training complex. MLB Player meals during ST and (if applicable) regular season; FSL Single-A Dunedin Jays meals; FCL meals.

**Termination:** Club can terminate at any time with 45 days notice. 5-day cure for default breach. Section 5(c).

**Special provisions:**
- **Favored Pricing clause (MFN):** Provider must make Meals/Snacks/Shakes available to Club at terms at least as favorable as any other Provider customer for equivalent or lower volume. Section 12(d). Operational implication: any pricing discounts to other accounts could trigger TBJ rate reductions retroactively.
- Force Majeure: standard, Section 22.
- Background check: full criminal investigation required for any employee with direct player/coach/staff contact. Section 4 + 12.

### TBJ - NY (Buffalo Bisons - AAA affiliate of TBJ)

**No separate contract found in this drop.** The TBJ master Services Agreement and SOW #1 explicitly scope to Dunedin (TD Ballpark + 3031 Garrison Road), and Buffalo is not mentioned in the agreement text. **Flag for Kevin:** the Bisons relationship may be covered under a separate SOW #2 not included in the contract package, or by an informal arrangement, or by a different contracting entity entirely (Rogers Blue Jays partnership owns the MLB and PDC sides; Buffalo Bisons is the AAA affiliate but may be a separately contracted entity).

**Spreadsheet evidence:** Buffalo Bisons services at $27.34/meal in projections. Two services (Snack, Shake) at $0 - likely placeholders pending pricing decision per `SC_PRICE_COMPARISON.md`.

### TBR - FL (Tampa Bay Rays - Port Charlotte PDC)

**Sources (4 documents):**
- TBR/Services Agreement Major League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf (master agreement, Effective Jan 1, 2024).
- TBR/Major League SOW 2024 EXECUTION Josh.pdf (ML SOW #1).
- TBR/Services Agreement Minor League Foodservice CJK Foods LLC dba Kitchfix 2024 Josh.pdf (master agreement).
- TBR/Minor League SOW 2024 EXECUTION Josh.pdf (MiLB SOW #1).

**Billing structure:** Per-meal Catering Fees + MiLB-only Service Fee.

**Payment schedule:**
- MiLB Service Fee = $382,448. Section 6(c) MiLB SOW:
  - $200,000 due upon SOW signing.
  - $182,448 due by Feb 1, 2024.
  - **Note: this Service Fee was a one-time front-load with two installments in early 2024, not an annual recurring charge.** Whether a renewed Service Fee applies for 2026 is unclear from this SOW alone - flag for Kevin.
- Per-meal Catering Fees (both ML and MiLB): weekly invoicing within 5 days of week-end. Section 6(b). Net 30 (Club makes reasonable efforts to pay by invoice due date).

**Deposit / prepayment:** The MiLB $200K upfront is a deposit-like construct (paid on SOW signing). MiLB Catering Fees reduced by 25% during the Term to amortize the Service Fee. Section 6(c).

**Per-meal rates (2024 base; subject to 75% of CPI annual adjustment):**

| Service | 2024 base | 2026 calculated (assuming 75% of ~3.5%/yr CPI for 2 yrs ≈ ~5.3% total) | Spreadsheet projection | Match? |
|---|---|---|---|---|
| ML Breakfast | $32.98 | ~$34.73 | $35.63 | CLOSE (~2.6% above estimate; consistent with actual CPI rates) |
| ML Lunch | $36.54 | ~$38.47 | $39.48 | CLOSE (~2.6%) |
| ML Dinner | $36.54 | ~$38.47 | $39.48 | CLOSE |
| ML Umpire Meal | $36.54 | ~$38.47 | $39.48 | CLOSE |
| MiLB Base Breakfast | $21.11 | ~$22.22 | n/a in spreadsheet (likely the "before service-fee discount" rate) | - |
| MiLB Post service-fee Breakfast | $15.84 | ~$16.68 | $17.83 (actuals "Breakfast - MiLB" only) | CLOSE (~6.9%) |
| MiLB Base Lunch/Dinner | $25.86 | ~$27.22 | $27.95 (Dinner) / $28.90 (Lunch - MiLB ST) | CLOSE for Dinner; ST rate higher |
| MiLB Post service-fee Lunch/Dinner | $19.40 | ~$20.42 | $21.67 (actuals "Lunch - MiLB") | CLOSE (~6.1%) |

**Note:** the "ST" suffix in the spreadsheet ("Breakfast - MiLB ST", "Lunch - MiLB ST") at $23.77 / $28.90 is HIGHER than the calculated 2026 base rate, suggesting these are the **Base** (pre-discount) MiLB ST rates while the non-ST rates after the 25% service-fee credit are the cost-basis ones flowing to actuals. The spreadsheet apparently captures both retail (ST) and post-discount (non-ST) per-meal prices as separate columns rather than a single service whose price changes mid-season.

**Flat-fee add-ons in spreadsheet (not in contract):**
- Extra Protein - Chicken/Pork ($111.84/pan), Extra Protein - Beef/Seafood ($162.17/pan) - confirmed flat fee in spreadsheet; NOT in the 2024 SOW base list. Likely added via informal amendment or operational practice.
- MLB Extra MTO Sm/Med/Lrg ($5/$10/$15) - same pattern.
- Extended Day Labor ($280 flat in actuals) - similar.

**Escalation:** 75% of CPI-U Food Away from Home - Full Service Meals and Snacks (Nov-to-Nov). Section 6(c) ML SOW / Section 6(a)(v-vi) MiLB SOW. Adjusts both Base and Post service-fee rates.

**Term and scope:**
- Initial Term: Jan 1, 2024 - Oct 1, 2026. ML and MiLB agreements have separate but parallel terms. Section 3 ML.
- First Extension Option: through Dec 31, 2027 (notice by Oct 1, 2026).
- Second Extension Option: through Dec 31, 2028 (notice by Nov 2027, if First Extension exercised).
- Scope ML: catering at Charlotte Sports Park during ST and Tropicana Field if Rays play home games (unlikely 2026 per current state). Personnel: MLB players, coaches, employees, contractors engaged in baseball games / training.
- Scope MiLB: MiLB teams (FCL Rays, A Charlotte Stone Crabs - actually now defunct; current FCL + AA Montgomery + AAA Durham etc.).

**Termination:** 10-day cure on default; Club can terminate at any time for any reason on 45 days notice (master agreement standard). Section 3.

**Special provisions:**
- **Right of First Negotiation (relocation):** If Rays announce a new Spring Training Site other than Charlotte Sports Park, Contractor has exclusive 30-day window to negotiate modification of both ML and MiLB agreements for the new site. If no agreement reached, Club is free to negotiate with third parties and agreements terminate when Rays vacate Charlotte Sports Park. Section 5 ML.
- **B&G (Boys & Girls Club) revenue stream** - this is a SEPARATE catering operation per the SC mapping doc. Not covered by either ML or MiLB SOW; likely a separate informal/oral arrangement. $6.50/lunch. **Flag for Kevin** - need a written agreement for this if not already in place.
- Force Majeure: Section 4 ML. Suspension Events include MLB delays/cancellations; Club excused from Service Fee during Suspension Event; parties negotiate in good faith for partial Services.
- Insurance limits unusually high: $10M each occurrence / $10M aggregate on General Liability; $10M auto. Reflects Tropicana Field exposure.

### TXR - TX - H (Texas Rangers MLB Home - Globe Life Field, Arlington)

**Source: TXR/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf (Effective Jan 21, 2026).**

**Billing structure:** Pure flat annual Services Fee. $604,032 for 2026.

**Payment schedule:** Six monthly installments April 1 - September 1, 2026. Each = $100,672 pre-tax / $108,977.44 with sales tax. Section 2(a).
- Invoiced 30 days in advance of each due date.
- Postseason: pro-rata Services Fee for each 2026 Postseason Game.

**Deposit / prepayment:** None. First invoice March 1 (30 days before April 1 due).

**Per-meal rates (none stated):** Contract is flat-fee. Spreadsheet $25.95 (same as STL-MO and CIN-OH standard MLB rate) is derived for SC tool projections.

**Catering allowance:** 12 post-game outside catered meals/year - Contractor coordinates ordering, Rangers pay catering cost. Contractor still provides standard all-day food + attendant present on those dates. Section 2(b).

**Term and scope:**
- Effective Jan 21, 2026 - Dec 31, 2026. Single-season contract.
- Scope: 3 meals per game for 60 people, ~81 home games + 1 workout day. Section 1(b).
- Additional daily offerings: Grab & Go snacks, packaged snacks/condiments/beverages, coffee service, MTO during first two meals each home game.
- Personnel ramp: 75% of full workforce hired and trained by Mar 1, 2026; minimum 6 fully-trained staff at Globe Life Field throughout regular season. Section 4(e).

**Termination:** 10-day cure on material breach. At-will with 30 days notice + pro-rata Services Fee through notice period. Section 3(b).

**Special provisions:**
- Force Majeure: not separately defined in this agreement (no Section 12 carve-out as in CIN - OH); subject to general MLB subservience suspension.
- MLB subservience: standard. Section 14.
- Visitor clubhouse coverage included in same contract scope - see TXR - TX - V below.

**Historical context:**
- TXR/Texas Rangers 2025 MLB Food Service Contract.pdf was the prior year's contract at $549,120. 2026 is a 10% YoY increase ($604,032 / $549,120 = 1.10). The increase is built into the 2026 contract directly rather than via a CPI escalator.

### TXR - TX - V (Texas Rangers MLB Visitors - Globe Life Field)

**Source: Same contract as TXR - TX - H** - Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf.

**Billing structure:** Part of the $604,032 flat annual fee covering both home and visitor clubhouse food service. **The visitor clubhouse is NOT separately billed** - it's bundled into the home contract.

**Scope (visitor clubhouse, Section 1(b)):**
- Grab & Go snack options made by Contractor.
- Packaged snacks, condiments, beverages.
- Coffee service.
- **No buffet, no MTO, no per-meal billing for visitors.**

**Per-meal rates (spreadsheet vs contract):** The TXR-TX-V spreadsheet shows the same $25.95 per-meal services (Arrival/Post BP/Post-Game/Umpire) as TXR-TX-H. **This appears inconsistent with the contract scope** - the visitor clubhouse contractually receives Grab & Go and snacks only, not full buffet meals. **Flag for Kevin** - either the spreadsheet is over-modeling visitor service (carrying placeholder structure from the home template), or the operational reality includes more than the contract scope (e.g., extra catering ordered ad hoc by visiting clubhouses and reimbursed).

**Termination, FM, MLB subservience:** Same as TXR - TX - H (one contract).

### TXR - AZ (Texas Rangers - Surprise AZ PDC)

**Source: TXR-AZ/Texas Rangers 2025-2027 Surprise Food Service Agreement.pdf (master agreement Effective Dec 13, 2024 per Effective Date in Section 1; SOW #1 dated Jan 7, 2025 covering 2025 season).**

**Billing structure:** Per-meal Per-Meal Fee + 20% Annual Deposit discount on each meal.

**Payment schedule:**
- Annual Deposit: 20% of total Services Fee, calculated on projected daily meals under all active SOWs. Section 2(b) master.
- Deposit due in 3 equal installments Jan 1, Feb 1, Mar 1 of each Term year.
- Per-meal fees invoiced weekly (Mon-Sun) for prior week's meals. Net 30. Section 3 master.

**Deposit / prepayment:**
- 2025 Total Annual Deposit: $297,419.26 (3 installments of $99,139.75). SOW #1 final block.
- Deposit triggers the **20% discount on every Per-Meal Fee** for the year. Section 2(a) master + SOW pricing tables.
- 2026 deposit: TBD by 2026 projected meal volume. **Flag for Kevin** - no 2026 SOW in the document package; the 2025 SOW is current as of analysis date; a 2026 SOW with updated deposit amount is needed.

**Per-meal rates (2025 SOW, pre/post deposit discount):**

| Service | 2025 list rate | 2025 after deposit | 2026 calculated (+2.5%) | Spreadsheet projection | Spreadsheet actuals | Match? |
|---|---|---|---|---|---|---|
| MLB ST Breakfast | $34.85 | $27.88 | $35.72 / $28.58 | $35.72 | $28.58 | YES |
| MLB ST Lunch | $34.85 | $27.88 | $35.72 / $28.58 | $35.72 | $28.58 | YES |
| MLB ST Dinner | (not in SOW, but in spreadsheet at $35.72) | (derived $28.58) | $35.72 / $28.58 | $35.72 | $28.58 | YES |
| Non-MLB Breakfast | $17.43 | $13.95 | $17.87 / $14.30 | $17.87 | $14.29 | YES (essentially exact) |
| Non-MLB Lunch | $17.43 | $13.95 | $17.87 / $14.30 | $17.87 | $14.29 | YES |
| Non-MLB Dinner | $17.43 | $13.95 | $17.87 / $14.30 | $17.87 | $14.29 | YES |
| Pre-game hot meal | $13.33 | $10.66 | $13.66 / $10.93 | $13.66 | $10.93 | YES |
| Regular Snack | $7.18 | $5.74 | $7.36 / $5.89 | $7.36 | $5.89 | YES |
| Continental Breakfast | (not in SOW) | (derived) | n/a | $8.20 | $6.56 | NEW - not in SOW pricing |
| Extra Protein - Chicken/Pork | (not in SOW) | n/a | n/a | n/a in projection | $115 in actuals (MLB + MiLB) | NEW |
| Extra Protein - Beef/Seafood | (not in SOW) | n/a | n/a | n/a in projection | $165 in actuals (MLB + MiLB) | NEW |

The MLB Dinner, Continental Breakfast, and Extra Protein services in the spreadsheet are **not present in the 2025 SOW pricing tables**. Either (a) added by informal amendment, (b) will be in a 2026 SOW, or (c) operational additions captured by the SC tool ahead of contractual definition. Flag for Kevin.

**Escalation:** Built-in 2.5% annual increase for 2026 and 2027 (over prior year). Section 2(a) master.

**Term and scope:**
- Initial Term: Jan 1, 2025 - Dec 31, 2027. Section 4(a) master.
- Renewal: up to 3 additional 1-year periods at Rangers' option, 90 days notice.
- Scope: Surprise AZ Spring Training facility. MLB ST, Non-MLB (extended camp / instructs / FCL Rangers / rehab) full-service buffet for breakfast/lunch/dinner, MTO once a month during breakfast, Coffee & Beverage (excluding bottled water/sports/protein drinks), Grab + Go all-day. SOW #1 sections.

**Termination:**
- 10-day cure on material breach.
- At-will: Team may terminate with **4 months prior notice** + pro-rata Services Fee. Section 4(c).
- If Team terminates without breach: Team must pay pro-rata of up to $75,000 spent on kitchen equipment installed at Team Facility. Provider retains any Service Fees previously paid. Section 4(c)(i)-(iii).

**Special provisions:**
- **Kitchen improvements investment:** Provider pays up to $75,000 for kitchen equipment installed at Team Facility. Section 5 master. Pro-rata refundable on Team termination.
- Non-solicitation: Team cannot solicit Provider clients/employees for 2 years post-termination. Section 7(f).
- Force Majeure: not separately defined in master; defers to general MLB subservience clauses.

## Contract vs spreadsheet rate comparison

Spreadsheet rates pulled from `SC_PRICE_COMPARISON.md` (Projection column). Mismatches flagged in the Match? column.

| Account | Group | Service | Contract Rate (year) | Spreadsheet Projection | Match? | Notes |
|---|---|---|---|---|---|---|
| CIN - AZ | Major League | Breakfast | $17.88 (2023) | $29.01 | NO - 62% gap | 2023 contract on file; operative 2026 pricing missing |
| CIN - AZ | Major League | Lunch | $17.88 (2023) | $29.01 | NO - 62% gap | |
| CIN - AZ | Major League | Dinner | $17.88 (2023) | $29.01 | NO - 62% gap | |
| CIN - AZ | Minor League | Breakfast | $11.35 (2023) | $18.42 | NO - 62% gap | |
| CIN - AZ | Minor League | Lunch | $11.35 (2023) | $18.42 | NO - 62% gap | |
| CIN - AZ | Minor League | Dinner | $11.35 (2023) | $18.42 | NO - 62% gap | |
| CIN - AZ | Minor League | Pre-Game Snack | $4.51 (2023) | $7.31 | NO - 62% gap | |
| CIN - AZ | Minor League | Coffee Service (tax-free) | $450/week (2023, max 45 wk = $20,250/yr) | $511.05/week | Different unit - spreadsheet appears to be weekly rate; ~14% higher than 2023 base |
| CIN - AZ | Minor League | Fountain Bev (tax-free) | $250/week (2023) | $283.92/week | ~14% higher than 2023 base |
| CIN - AZ | Rehab | Continental Plus | (not in 2023 SOP) | $9.08 | NEW |
| CIN - AZ | Rehab | Breakfast / Lunch / Dinner | (defaults to MiLB rate per 2023 SOP) | $18.42 | Same as MiLB - consistent |
| CIN - KY | Louisville Bats | Breakfast | $25.95 (2026 executed) | $25.95 | YES |
| CIN - KY | Louisville Bats | Lunch | $25.95 (2026) | $25.95 | YES |
| CIN - KY | Louisville Bats | Post-Game | $25.95 (2026) | $25.95 | YES |
| CIN - KY | Louisville Bats | Umpire | $25.95 (2026) | $25.95 | YES (umpire not separately defined in contract; defaults to same buffet rate) |
| CIN - KY | Louisville Bats | Snack | $8.64 (2026) | $8.64 | YES |
| CIN - OH | Cincinnati Reds | Arrival | flat fee, derived (~$29.84 from $362.5K / ~12,150 meals) | $25.95 | N/A (flat fee contract) - spreadsheet rate is a projection-tracking convention |
| CIN - OH | Cincinnati Reds | Post BP | flat fee, derived | $25.95 | N/A |
| CIN - OH | Cincinnati Reds | Post-Game | flat fee, derived | $25.95 | N/A |
| CIN - OH | Cincinnati Reds | Umpire | flat fee, derived | $25.95 | N/A |
| STL - FL | MLB | Breakfast - ST | flat fee (Jupiter Amendment $2.3M total) | $40.00 | N/A |
| STL - FL | MLB | Lunch - ST | flat fee | $40.00 | N/A |
| STL - FL | MiLB | Breakfast - ST | flat fee | $40.00 | N/A |
| STL - FL | MiLB | Lunch - ST | flat fee | $40.00 | N/A |
| STL - FL | MiLB | Breakfast | flat fee | $26.00 | N/A |
| STL - FL | MiLB | Lunch | flat fee | $26.00 | N/A |
| STL - FL | MiLB | Snack | flat fee | (blank) | N/A |
| STL - FL | Palm Beach Cardinals | Arrival | flat fee | $26.00 | N/A |
| STL - FL | Palm Beach Cardinals | Pre-Game | flat fee | $26.00 | N/A |
| STL - FL | Palm Beach Cardinals | Post-Game | flat fee | $26.00 | N/A |
| STL - FL | Fun Money | Fun Money allocation | (not in Jupiter Amendment) | $25,000 | NEW - flag for Kevin; not contractually defined |
| STL - MO | St. Louis Cardinals | Arrival | flat fee ($698K total) | $25.95 | N/A |
| STL - MO | St. Louis Cardinals | Post BP | flat fee | $25.95 | N/A |
| STL - MO | St. Louis Cardinals | Post-Game | flat fee | $25.95 | N/A |
| STL - MO | St. Louis Cardinals | Umpire | flat fee | $25.95 | N/A |
| TBJ - FL | Major League - PDC | Breakfast | $20.29 (2023 base) | $23.12 | NO - 14% gap; consistent w/ CPI escalation 2023-2026 |
| TBJ - FL | Major League - PDC | Lunch | $20.29 (2023) | $23.12 | NO - 14% |
| TBJ - FL | Major League - PDC | Dinner | $20.29 (2023) | $23.12 | NO - 14% |
| TBJ - FL | Major League - PDC | Umpire | $20.29 (2023) | $23.12 | NO - 14% |
| TBJ - FL | Major League - PDC | Post Game Meal | $20.29 (2023) | $23.12 | NO - 14% |
| TBJ - FL | Major League - PDC | Snack | $1.50 (2023 Snack Fee) | $1.70 | NO - 13% gap; CPI |
| TBJ - FL | Minor League - PDC | Breakfast | $10.14 (2023 FCL) | $11.55 | NO - 14% |
| TBJ - FL | Minor League - PDC | Lunch | $10.14 (2023) | $11.55 | NO - 14% |
| TBJ - FL | Minor League - PDC | Dinner | $10.14 (2023) | $11.55 | NO - 14% |
| TBJ - FL | Single A Jays | Breakfast | $14.50 (2023 FSL) | $16.51 | NO - 14% |
| TBJ - FL | Single A Jays | Pre-Game | $14.50 (2023) | $16.51 | NO - 14% |
| TBJ - FL | Single A Jays | Post-Game | $14.50 (2023) | $16.51 | NO - 14% |
| TBJ - FL | SSM | Stadium Staff Meals | (not in 2023 SOW) | $16.51 | NEW - flag |
| TBJ - FL | Other | Fun $$$$ Allocated | (not in 2023 SOW) | $28,472.76 | NEW - flag |
| TBJ - FL | Other | Media Meals | (not in 2023 SOW) | $16.00 | NEW - flag |
| TBJ - FL | Other | MLB G&G Pantry | (not in 2023 SOW) | $1.70 | NEW (same as snack price - might be redirection of Snack Fee) |
| TBJ - FL | Other | MiLB G&G Pantry | (not in 2023 SOW) | $1.70 | NEW |
| TBJ - FL | Other | MLB Catering | (not in 2023 SOW) | $38.00 | NEW - flag |
| TBJ - FL | Other | Team Canada | (not in 2023 SOW) | $11.55 | NEW (matches FCL post-CPI rate) |
| TBJ - NY | Buffalo Bisons | Breakfast | (no contract found) | $27.34 | NO CONTRACT - flag |
| TBJ - NY | Buffalo Bisons | Lunch | (no contract found) | $27.34 | NO CONTRACT |
| TBJ - NY | Buffalo Bisons | Post-Game | (no contract found) | $27.34 | NO CONTRACT |
| TBJ - NY | Buffalo Bisons | Umpire | (no contract found) | $27.34 | NO CONTRACT |
| TBJ - NY | Buffalo Bisons | Snack | (no contract found) | $0.00 | NO CONTRACT + placeholder price |
| TBJ - NY | Buffalo Bisons | Shake | (no contract found) | $0.00 | NO CONTRACT + placeholder price |
| TBR - FL | Major League | Breakfast | $32.98 (2024 base) | $35.63 | NO - 8% gap; consistent w/ 75% CPI escalation 2024-2026 |
| TBR - FL | Major League | Lunch | $36.54 (2024) | $39.48 | NO - 8% |
| TBR - FL | Major League | Dinner | $36.54 (2024) | $39.48 | NO - 8% |
| TBR - FL | Major League | Umpire Meal | $36.54 (2024) | $39.48 | NO - 8% |
| TBR - FL | Major League | Extra Protein - Chicken/Pork | (not in 2024 SOW) | $111.84 | NEW - flag |
| TBR - FL | Major League | Extra Protein - Beef/Seafood | (not in 2024 SOW) | $162.17 | NEW - flag |
| TBR - FL | Major League | MLB Extra MTO Sm/Med/Lrg | (not in 2024 SOW) | $5 / $10 / $15 | NEW - flag |
| TBR - FL | Minor League | Breakfast - MiLB ST | $21.11 (2024 base) | $23.77 | NO - 12.6%; ST-only base rate, no service-fee discount applied |
| TBR - FL | Minor League | Lunch - MiLB ST | $25.86 (2024 base) | $28.90 | NO - 11.8% |
| TBR - FL | Minor League | Dinner | $19.40 (2024 post-discount) | $27.95 | NO - 44%; spreadsheet using a higher rate than the discounted post-service-fee rate |
| TBR - FL | Minor League | After Hours Meals | (not in 2024 SOW) | $27.95 | NEW |
| TBR - FL | Minor League | Road Sandwiches - MiLB | (not in 2024 SOW) | $15.00 | NEW |
| TBR - FL | Minor League | Extra Protein - Chicken/Pork | (not in 2024 SOW) | $111.84 | NEW |
| TBR - FL | Minor League | Extra Protein - Beef/Seafood | (not in 2024 SOW) | $162.17 | NEW |
| TBR - FL | Boys & Girls Club | B&G Lunch | (NO CONTRACT) | $6.50 | NO CONTRACT - flag |
| TXR - AZ | Major League | Breakfast | $34.85 (2025) / +2.5% = $35.72 (2026) | $35.72 | YES (exact match w/ 2026 escalated rate) |
| TXR - AZ | Major League | Lunch | $34.85 (2025) / $35.72 (2026) | $35.72 | YES |
| TXR - AZ | Major League | Dinner | (not in SOW; assumed = $35.72) | $35.72 | YES |
| TXR - AZ | Major League | Extra Protein - C/P | (not in SOW) | $115 (actuals only) | NEW |
| TXR - AZ | Major League | Extra Protein - B/S | (not in SOW) | $165 (actuals only) | NEW |
| TXR - AZ | Minor League | Breakfast | $17.43 (2025) / $17.87 (2026) | $17.87 | YES |
| TXR - AZ | Minor League | Lunch | $17.43 (2025) / $17.87 (2026) | $17.87 | YES |
| TXR - AZ | Minor League | Dinner | $17.43 (2025) / $17.87 (2026) | $17.87 | YES |
| TXR - AZ | Minor League | Continental Breakfast | (not in SOW) | $8.20 | NEW |
| TXR - AZ | Minor League | Pre-Game Hot Snack | $13.33 (2025) / $13.66 (2026) | $13.66 | YES |
| TXR - AZ | Minor League | Regular Snack | $7.18 (2025) / $7.36 (2026) | $7.36 | YES |
| TXR - AZ | Minor League | Extra Protein - C/P | (not in SOW) | $115 (actuals only) | NEW |
| TXR - AZ | Minor League | Extra Protein - B/S | (not in SOW) | $165 (actuals only) | NEW |
| TXR - TX - H | Texas Rangers | Arrival | flat fee ($604K total) | $25.95 | N/A |
| TXR - TX - H | Texas Rangers | Post BP | flat fee | $25.95 | N/A |
| TXR - TX - H | Texas Rangers | Post-Game | flat fee | $25.95 | N/A |
| TXR - TX - H | Texas Rangers | Umpire | flat fee | $25.95 | N/A |
| TXR - TX - V | Texas Rangers | Arrival | bundled flat fee (visitor scope = G&G + snacks + coffee only) | $25.95 | SCOPE MISMATCH - flag |
| TXR - TX - V | Texas Rangers | Post BP | bundled flat fee | $25.95 | SCOPE MISMATCH |
| TXR - TX - V | Texas Rangers | Post-Game | bundled flat fee | $25.95 | SCOPE MISMATCH |
| TXR - TX - V | Texas Rangers | Umpire | bundled flat fee | $25.95 | SCOPE MISMATCH |

## Schema implications

Issues in the executed contracts that the current `sc-1` Postgres schema (as
described in `SC_SPREADSHEET_MAPPING.md`) does not appear to handle. Each
item: what the contract says + what the schema lacks + suggested fix.

1. **Hybrid billing (flat fee + per-meal).** CIN - AZ (2023 doc) and CIN - OH both pair a flat annual Service Fee with per-item billing. TBR - FL MiLB pairs a one-time Service Fee deposit with per-meal billing at a discounted rate. The current schema has a single `accounts.billing_model` enum with three states (`actuals_drive_invoice`, `projections_drive_invoice`, `flat_fee`) - it cannot represent "hybrid: flat fee X + per-meal Y." Suggested fix: extend the billing_model enum or add a `billing_components` jsonb column with sub-records for each fee component (e.g., `{"type":"flat_fee","amount":362500,"schedule":"6 monthly"}, {"type":"per_meal_reimbursable","items":"food and supplies"}`).

2. **Deposit + discount triggered by deposit (TXR - AZ).** Contract specifies 20% deposit on Total Annual Services Fee that triggers a 20% per-meal discount. Schema has no deposit-tracking table or discount-applied-once-deposited semantic. Suggested fix: `sc_account_deposits` table with `account_key, year, deposit_amount, due_date_1, due_date_2, due_date_3, paid_date, triggers_discount_pct`.

3. **Annual escalation clauses with CPI floor/cap.** CIN - AZ (2%/5%), CIN - OH (1%/4%), STL - MO (CPI no floor/cap), TBR - FL (75% of CPI), TBJ - FL (CPI, max 1/yr), TXR - AZ (built-in 2.5%/yr 2026 + 2027). Schema has no `sc_price_escalation_rules` table to record the per-account escalation method. Suggested fix: `sc_price_escalation_rules` with `account_key, escalation_type ('cpi'|'fixed_pct'|'cpi_capped'), base_year, cpi_series, floor_pct, cap_pct, fixed_pct, reference_month`.

4. **Payment schedule separate from invoicing frequency.** Several contracts decouple the **invoicing** cadence (weekly/bi-monthly/monthly for cost reimbursement) from the **fixed-fee payment** cadence (quarterly Jupiter, 6-monthly TXR/STL-MO/CIN-OH, 7-installment 2025 CIN-OH including the Jan-2027 backloaded payment). Schema currently combines them. Suggested fix: split `sc_account_billing` into `sc_account_invoicing_cadence` (per-meal/cost reimbursement schedule) and `sc_account_fixed_fee_schedule` (installment table with `due_date, amount, type`).

5. **Postseason rate adders.** CIN - OH ($4,413.58 game / $2,206.79 workout), STL - MO ($5,222.22 game / $2,777.78 workout / $600 road), TXR - TX - H (pro-rata of Services Fee per Postseason Game). Schema has no postseason-specific pricing. Suggested fix: `sc_postseason_rates` with `account_key, rate_type ('regular_game'|'workout'|'road'), rate, escalation_applies bool`.

6. **Minimum meal guarantees.** CIN - KY: "minimum of 11 buffet meals per standard 6-game homestand" - if Club orders fewer, contract is silent on penalty / make-whole. Schema has no minimum-volume tracking. Suggested fix: `sc_minimum_commitments` table.

7. **72-hour outside-catering clause (CIN - KY).** Contract gives KitchFix right to "seek compensation for the cost of any lost product" when outside catering is ordered with less than 72 hours notice. Schema can't represent this conditional billable event. Suggested fix: add `sc_outside_catering_events` to track cancelled meals + lost-product claims.

8. **Work-stoppage provisions with phased billing (STL - FL).** Jupiter Amendment Section 2(c) specifies a multi-step payment ladder if MLB work stoppage hits 2027. Schema has no work-stoppage scenario tracking. Suggested fix: this is operational-only; if 2027 work stoppage occurs, the Mar 31 / Apr 1 / June 30 dates need to be in the runbook, not the schema.

9. **Termination fees / Kitchen-equipment refund (STL - MO, TXR - AZ).** STL - MO termination fee scales by year ($60K/$40K/$20K). TXR - AZ termination triggers a pro-rata refund of up to $75K kitchen equipment investment. Schema has no termination-cost field. Suggested fix: `sc_termination_terms` with `account_key, termination_year, termination_fee, notice_period_days`.

10. **Favored Pricing (MFN) clause (TBJ - FL).** Section 12(d) requires Provider to extend any lower price given to other accounts to TBJ. **Schema cross-account-pricing implications:** if a different account ever gets a lower per-meal rate for substantially similar volumes, TBJ rates must drop. There's no automated check for this. Suggested fix: add a `mfn_clause = true` flag at the account level + an automated cross-account price comparison alert.

11. **B&G (TBR - FL) and Buffalo Bisons (TBJ - NY) - no contracts found.** These show up in the spreadsheet with pricing but no executed agreement is in this contract package. Schema currently treats them as normal accounts/groups. Suggested fix: add a `contract_status` enum (`executed`|`oral`|`missing`) on `accounts` and surface a warning in the SC tool for missing-contract accounts.

12. **Visitor clubhouse scope mismatch (TXR - TX - V).** Contract scope = Grab & Go + snacks + coffee only. Spreadsheet models full buffet (Arrival / Post BP / Post-Game / Umpire at $25.95 each). Either the spreadsheet over-models (placeholder structure carried over from home template) or operational reality includes more. Schema has no "scope mismatch flag." Suggested fix: add `sc_service_scope_notes` to record contractually-defined vs operationally-served splits, OR delete the V-clubhouse services that aren't contractually defined.

13. **Service Fee front-load (TBR - FL MiLB $382,448).** One-time payment in two installments during initial year; whether the Service Fee renews in later years isn't specified in the 2024 SOW. Schema treats all fees as recurring annual. Suggested fix: add `recurrence` to fixed-fee schedule entries (`annual`|`one_time`|`initial_only`).

14. **Bundled tax-free flat fees (CIN - AZ Coffee/Fountain).** Contract: $450/wk coffee + $250/wk fountain bev, max 45 weeks/year, tax-free. Schema mapping confirms `is_tax_free=true, is_flat_fee=true` is supported. **Match.** But the schema doesn't represent the **max 45 weeks/year** cap. Suggested fix: add `max_weeks_per_year` or `max_billable_units_per_year` on `sc_services`.

15. **Education / cooking-demo services (CIN - AZ $1,000/class).** Ad-hoc service triggered by Club request. Schema doesn't seem to support ad-hoc-event pricing. Suggested fix: optional `sc_ad_hoc_service_events` table.

16. **Coordinated outside catering credits/transfers (TXR - TX - H 12 post-game catered meals).** Contractor coordinates 12 catered meals/year; Rangers pay the caterer directly. KitchFix is still required to provide all-day Grab & Go + attendant on those dates. Schema would need a way to represent "no buffet served + reduced billing + Rangers-direct payment to third party" combined with "still providing G&G." Suggested fix: this might be handled via `sc_day_metadata.event_label = 'outside_catered'` to suppress projection/actuals counting for the main buffet on that day.

17. **Sales tax itemization separately on invoice.** All contracts state "fees are not inclusive of sales tax" and tax is to be separately itemized. Spreadsheet generally has tax-free flag at service level for flat fees, but per-meal services in the spreadsheet don't always show a tax-applied projection. Schema mapping shows `is_tax_free` flag but not a global tax-rate-by-jurisdiction lookup. Suggested fix: `sc_account_tax_rates` for AZ, OH, FL, MO, NY, KY, TX with effective dates - or rely on accounting system downstream of invoicing.

**Total schema implications: 17 issues / suggested fixes.**

## Billing model validation

Reviewing the current `accounts.billing_model` assignments against what the contracts actually say.

| Account | Current model | Contract evidence | Recommendation |
|---|---|---|---|
| CIN - AZ | actuals_drive_invoice | 2023 contract: hybrid Service Fee + per-meal Catering Fees. Invoicing every 15 days for catering fees based on actual meals served. The Service Fee is fixed annual. | **CHANGE to hybrid** (or `actuals_drive_invoice` + fixed-fee component). Current single-axis flag undersells the structure. As a single best-fit, `actuals_drive_invoice` is closest because per-meal billing is the variable component. **Keep as-is for now** if hybrid can't be modeled; document caveat. |
| CIN - KY | actuals_drive_invoice | 2026 executed: pure per-meal, weekly invoicing on actual meals served. **No deposit, no lump sum, no service fee.** | **KEEP** as `actuals_drive_invoice`. Recent move from `projections_drive_invoice` to actuals (per mapping doc footnote) is correct. |
| CIN - OH | projections_drive_invoice | 2025-26 contract: flat Services Fee ($362,500 in 2026) + reimbursed food/supplies (Net 30 after each homestand). Per-meal not contractually billed. | **CHANGE to flat_fee** (or hybrid if supported). `projections_drive_invoice` is misleading - the Services Fee is paid on a fixed schedule regardless of projected meal counts. **Recommendation: change to `flat_fee`.** |
| STL - FL | flat_fee | Jupiter Amendment: $2.3M Total Annual Fee, quarterly installments + bi-monthly cost reimbursement. | **KEEP** as `flat_fee`. Best match for the dominant billing pattern. |
| STL - MO | projections_drive_invoice | Base STL contract: flat Annual Service Fee $698K, 6 monthly installments + cost reimbursement. | **CHANGE to flat_fee** (same logic as CIN - OH). |
| TBJ - FL | actuals_drive_invoice | 2023 SOW + escalation: annual Service Fee $452,812 + per-meal Meal Fees (weekly invoicing on actual meals/snacks/shakes). Hybrid. | **CHANGE to hybrid** if supported, else keep `actuals_drive_invoice` (the per-meal component is dominant in volume). |
| TBJ - NY | actuals_drive_invoice | No contract in this drop. Spreadsheet has per-meal projection prices ($27.34). Assuming oral/separate arrangement that mirrors per-meal billing. | **KEEP** as `actuals_drive_invoice` provisionally; **flag for Kevin** to confirm contract source or document oral arrangement. |
| TBR - FL | actuals_drive_invoice | 2024 SOWs: pure per-meal pricing for ML (no annual Service Fee), MiLB has one-time $382,448 Service Fee (2024 only) + per-meal at discounted rate. Per-meal volume is the dominant ongoing billing component. | **KEEP** as `actuals_drive_invoice`. The MiLB Service Fee is initial-only; ongoing billing is per-meal. |
| TXR - TX - H | projections_drive_invoice | 2026 contract: pure flat fee $604,032, 6 monthly installments April-September. No per-meal billing. | **CHANGE to flat_fee**. Same logic as CIN - OH / STL - MO. |
| TXR - TX - V | projections_drive_invoice | Same 2026 contract as TXR - TX - H; visitor scope is bundled in flat fee. | **CHANGE to flat_fee**. The scope-mismatch issue (Schema Implication #12) is a separate concern. |
| TXR - AZ | actuals_drive_invoice | 2025 SOW: per-meal pricing + annual 20% Deposit that triggers 20% discount on per-meal rate. Per-meal volume is the variable component; deposit is fixed prepayment. | **KEEP** as `actuals_drive_invoice`. Per-meal billing is dominant; deposit handling needs separate tracking per Schema Implication #2 but doesn't change the primary billing model classification. |

### Summary of billing model changes recommended

| From | To | Accounts |
|---|---|---|
| `projections_drive_invoice` | `flat_fee` | CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V |
| `actuals_drive_invoice` | hybrid (if added) | CIN - AZ, TBJ - FL |
| `actuals_drive_invoice` | (unchanged) | CIN - KY, TBJ - NY, TBR - FL, TXR - AZ |
| `flat_fee` | (unchanged) | STL - FL |

If `hybrid` is not added as a new enum value, leave CIN - AZ and TBJ - FL as `actuals_drive_invoice` and note the caveat. The four `projections_drive_invoice` -> `flat_fee` changes are clean and recommended regardless of whether `hybrid` exists.

**Note:** The `projections_drive_invoice` enum label is misleading for the four MLB accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V). The "projections drive the invoice" phrasing implies projected meal counts are billed, but the contracts pay a flat fee on a fixed schedule regardless of projected counts. The projections in the SC tool are operational planning artifacts, not billing inputs for these accounts. Recommend the schema split into `flat_fee` (these 4) and reserve `projections_drive_invoice` for accounts where projected counts genuinely drive billing (currently: none in this portfolio).
