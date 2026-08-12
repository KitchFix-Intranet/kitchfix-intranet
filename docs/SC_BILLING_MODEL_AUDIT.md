# Service Calendar - Billing Model Audit

> **[2026-08-11 WITHDRAWAL NOTE]** All TBR-FL "75% of CPI" / "Nov-to-Nov" / "75% of CPI Nov-to-Nov" escalation claims in this audit (TBR-FL row in the per-account audit table, the escalation-list line, the empirical-answer paragraph re: 25% discount that also cites 75% of projections math for MiLB) are WITHDRAWN as UNVERIFIED per REF-129 §B.4 withdrawal. Do NOT quote to the client, print in any deck, or use in internal projections. Actual escalation basis is UNVERIFIED pending a direct read of the signed agreement (owners: Joe Lessard / Josh Katt). NOTE: the "MiLB actuals = 75% of projections" line refers to the separate 25% SF buy-down mechanic (a real, distinct feature), NOT the withdrawn CPI escalation - preserved as-is.

**To:** Chat-Claude (for the next-bundle scoping: fee schedule + calendar accuracy)
**From:** CC (read-only audit)
**Date:** 2026-06-18
**Repo SHA:** main `2aa6074` (build worktree) / probe ran against live PG
**Contracts source:** `/Users/kevinfietek/Documents/Claude /Contracts/drive-download-20260615T205813Z-3-001`
**Canonical contract analysis:** `docs/SC_CONTRACT_BILLING_SUMMARY.md` (603 lines, in main). This audit consolidates that doc's per-account findings against current PG state and the codebase.

Read-only throughout. No edits, no writes.

---

## 1. Contracts folder

### 1.1 Location + access

`/Users/kevinfietek/Documents/Claude /Contracts/drive-download-20260615T205813Z-3-001/` (Google Drive download dated 2026-06-15). Outside the repo; readable via filesystem. The repo's `docs/SC_CONTRACT_BILLING_SUMMARY.md` is the canonical extraction Chat-Claude wrote off these same files - **build on that, do not re-derive**.

### 1.2 File inventory

| Account | Contract file | Format |
|---|---|---|
| CIN-AZ (Reds Goodyear PDC) | `REDS/Reds & Kitchfix Signed Agreement-2023 copy.pdf/docx` | Initial 2023 contract; renewal options through 2027 |
| CIN-KY (Louisville Bats AAA) | `Bats/KitchFix_2026LouisvilleAgreement_4.22.26.pdf` (executed) + 3 DRAFT/redline docx + 1 2025 contract | Single-season 2026 |
| CIN-OH (Reds MLB) | `CINN/2025-26 Reds-KitchFix Food Services Agreement.pdf` | 2025-26 base + 2027 option |
| STL-FL (Cardinals Jupiter PDC) | `JUPITER/KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.pdf` | **AMENDMENT** to STL-MO base; effective Oct 3, 2025 |
| STL-MO (Cardinals MLB Busch) | `STL/2025-27 Food Services Agreement St. Louis Cardinals + KitchFix.pdf` | 2025-27 base agreement |
| TBJ-FL (Blue Jays Dunedin PDC) | `TBJ/Complete_with_DocuSign_Final_Dunedin_Caterin - Final.pdf` | Master + SOW #1; effective Apr 5, 2023; in Renewal Term Year 1 |
| TBJ-NY (Buffalo Bisons AAA) | **NO CONTRACT IN PACKAGE** | Gap - flag |
| TBR-FL (Rays Port Charlotte PDC) | `TBR/Services Agreement Major League Foodservice...` + `Services Agreement Minor League Foodservice...` + 2 SOW PDFs (4 docs total) | 2024-26 base + extension options through 2028 |
| TXR-AZ (Rangers Surprise PDC) | `TXR-AZ/Texas Rangers 2025-2027 Surprise Food Service Agreement.pdf` + 2022 prior-term | 2025-27 master + 2025 SOW |
| TXR-TX-H (Rangers MLB Globe Life) | `TXR/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf` + 2024/2025 prior-year PDFs | Single-season 2026 |
| TXR-TX-V (Rangers MLB Visitors) | Same contract as TXR-TX-H | Visitor scope = G&G + snacks + coffee only |
| CORP (KitchFix internal) | No contract (administrative account) | n/a |

**Gaps:**
- **TBJ-NY (Buffalo Bisons)** - no separate contract in the package. The TBJ master scopes to Dunedin TD Ballpark + 3031 Garrison Road only; Buffalo is not in the contract text. Bisons may be covered under an SOW #2 not included in this drop, an informal arrangement, or a separate contracting entity (Rogers Blue Jays partnership). Flagged in `SC_CONTRACT_BILLING_SUMMARY.md:268-272`.

---

## 2. Per-account billing model

The grid below is the audit-level summary; for the contract-language quotes and clause-by-clause detail, see `SC_CONTRACT_BILLING_SUMMARY.md`. I'm not re-quoting verbatim what's already in the canonical doc.

| Account | Category | Billing model | Annual base + structure | Escalator | Critical extras / quirks |
|---|---|---|---|---|---|
| **CIN-AZ** (Reds Goodyear) | PDC spring training | **Hybrid** (Service Fee + per-meal Catering Fees) | 2023: $402,016 Service Fee (30% of $1.34M budget) + per-meal. Operative 2026 pricing NOT in the 2023 doc - the spreadsheet $29.01 MLB Breakfast is ~62% above the 2023 base + max CPI, meaning an amendment exists out-of-band | CPI-U Food Away from Home (Oct base), floor 2%, cap 5% | Volume threshold at 72,890 meals (Exhibit B); Coffee Service $450/wk + Fountain Beverages $250/wk (tax-free, max 45 wk/yr); Cooking demo $1,000/class |
| **CIN-KY** (Louisville Bats) | MiLB AAA | **Per-meal only**, two-tier (Breakfast/Lunch/Post-Game/Umpire $25.95; Snack $8.64) | Est. 2026 annual: $186,462 + tax | None (single-season 2026) | 72-hour outside-catering notice clause; Post-Game service may not start opening day - parties meet after first two homestands in May |
| **CIN-OH** (Reds MLB) | MLB | **Flat fee** (Services Fee) + reimbursed food/supplies + reimbursed clubhouse extras | 2025: $357,500 in 7 installments (6 × $56,250 Mar-Aug + $20,000 Jan 1, 2027 true-up). 2026 base: $362,500 in 6 monthly installments | CPI-U Food Away from Home (Aug to Aug), floor 1%, cap 4% | **Post-season per-game add-on: $4,413.58 + tax (1/81 of Services Fee); Post Season Workout Day: $2,206.79 (50% of game rate)**. Food/supplies fully passthrough at cost (Net 30); Clubhouse Extras also passthrough |
| **STL-FL** (Cardinals Jupiter) | PDC - flagged for promotion to fee | **PURE FLAT FEE** | **$2,300,000/yr total**: $1,400,000 in quarterly installments (Nov 1, Feb 1, May 1, Aug 1, +1 in 2027 per work-stoppage section) + $900,000 food/supplies passthrough (bi-monthly invoiced) | Not stated (contract is co-terminous with STL-MO base, which has CPI) | Annual upkeep: $15K equipment (rolls over), $4K storage pod, $11K temporary cooler (ST only); **2027 work-stoppage clause earns $350K + tax even if no services rendered Jan-Mar 2027**; 180-day termination for convenience; first installment Nov 1 is a 3-months-ahead prepayment |
| **STL-MO** (Cardinals MLB) | MLB | **Pure flat fee** | **$698,000/yr** = $423,000 in 6 monthly installments (Mar-Aug) + $50,000 Road Food Management (annual Mar 1) + $225,000 food/supplies budget | CPI-U Food Away from Home (Aug to Aug), no floor/cap stated | Post Season Game: $5,222.22; Post Season Workout: $2,777.78; Road Food postseason: $600; Termination-for-convenience fees: $60K (2025) / $40K (2026) / $20K (2027); Contractor invests $60K equipment over Term (becomes Cardinals property) |
| **TBJ-FL** (Blue Jays Dunedin) | PDC spring training | **Hybrid** (Service Fee + per-meal + per-snack + per-shake) | $452,812/yr Service Fee + per-meal | CPI Food Away From Home; one increase per Agreement Year; Provider notice by Jan 31, Club approval not unreasonably withheld | **Favored Pricing (MFN) clause** - rates to TBJ must be at least as good as any other Provider customer for equivalent or lower volume; weekly invoicing within 5 days of week end; auto-renews up to 3x 1-year extensions; flagged: Stadium Staff/Media Meals/Team Canada/Fun $$$$ are NOT in 2023 SOW #1 base list (later additions) |
| **TBJ-NY** (Buffalo Bisons) | MiLB AAA | **Unknown - no contract in package** | n/a | n/a | Spreadsheet has Buffalo Bisons at $27.34/meal in projections; assumption-only |
| **TBR-FL** (Rays Port Charlotte) | PDC spring training | **Per-meal Catering Fees + MiLB Service Fee** (the Service Fee was a one-time front-load with two installments in early 2024, not annual) | MiLB Service Fee 2024: $382,448 ($200K on signing + $182,448 by Feb 1 2024). MiLB Catering Fees reduced by 25% during Term to amortize the Service Fee | ~~75% of CPI-U Food Away from Home (Nov to Nov); adjusts both Base and Post service-fee rates~~ **[WITHDRAWN 2026-08-11 - UNVERIFIED per REF-129 §B.4]** | Two SOWs (ML + MiLB separate but parallel); Right of First Negotiation on Rays relocation; **B&G (Boys & Girls Club) separate informal revenue stream at $6.50/lunch - NOT covered by either SOW, flag for written agreement**; flat-fee add-ons (Extra Protein, MTO sizes, Extended Day Labor) appear in spreadsheet but not in SOW |
| **TXR-AZ** (Rangers Surprise) | PDC spring training | **Per-meal Per-Meal Fee + 20% Annual Deposit discount** | 2025 Annual Deposit: $297,419.26 (3 installments Jan 1, Feb 1, Mar 1); deposit triggers **20% discount on every Per-Meal Fee** for the year. Per-meal fees invoiced weekly Net 30 | Built-in 2.5% annual increase 2026/2027 (over prior year) | **Kitchen improvements investment $75K** by Contractor at Team Facility (pro-rata refundable on Team termination); 4-month at-will termination notice; Continental Breakfast + MLB Dinner + Extra Protein services in spreadsheet but NOT in 2025 SOW pricing - flag |
| **TXR-TX-H** (Rangers MLB Home) | MLB | **Pure flat annual Services Fee** | **$604,032 for 2026** in 6 monthly installments (Apr 1 - Sep 1) at $100,672 pre-tax / $108,977.44 with sales tax | None in this single-year contract; built-in 10% YoY (prior 2025 was $549,120, increase is direct, not CPI) | Postseason: pro-rata Services Fee per 2026 Postseason Game (~$7,457.93/game); 12 post-game outside catered meals/year (Rangers pay catering cost direct); 30-day at-will termination notice |
| **TXR-TX-V** (Rangers MLB Visitors) | MLB | **Bundled into TXR-TX-H** (NOT separately billed) | Part of the same $604,032 flat fee | n/a | **Visitor scope per contract = G&G snack options + packaged snacks/condiments/beverages + coffee service ONLY. No buffet, no MTO.** Spreadsheet mirroring TXR-TX-H buffet services for TXR-TX-V is contractually inconsistent (see section 4 below) |

### 2.1 At-a-glance: which accounts are billing-model-simple vs genuinely complex

**SIMPLE (clean flat fee or clean per-meal):**
- **STL-MO** - pure flat fee, fixed installments, simple CPI. Postseason add-ons are well-defined per-game.
- **CIN-OH** - flat Services Fee + clean Net-30 passthrough for food/supplies. CPI is clean.
- **TXR-TX-H** - pure flat fee, fixed installments, single-year. No CPI mechanic (direct rate set).
- **CIN-KY** - pure per-meal, two-tier, single-season. No escalator.

**MEDIUM (hybrid but well-defined):**
- **CIN-AZ** - hybrid (Service Fee + per-meal) but the 2023 doc on file doesn't reflect operative 2026 pricing; there's an amendment Chat-Claude couldn't find. **The per-meal rate gap (~62% above 2023 base + max CPI) means the contract on file is incomplete for billing purposes today.**
- **TXR-AZ** - per-meal with a 20% deposit discount mechanic. 2026 SOW is missing from package; need updated.
- **TBJ-FL** - hybrid with annual Service Fee + per-meal + MFN/favored-pricing clause. Multi-line item structure.

**COMPLEX (real edge cases for the fee-schedule build):**
- **STL-FL** - pure flat fee but with a quarterly cadence + bi-monthly food passthrough + ongoing upkeep line items + 2027 work-stoppage standby fees. Not a single annual number; multiple line items with different schedules.
- **TBR-FL** - Service Fee was one-time front-loaded in 2024 (not annual recurring); MiLB rates reduced 25% during Term to amortize. Two SOWs (ML/MiLB) in parallel. Pre-vs-post-discount per-meal pricing.
- **TXR-TX-V** - billing structure ambiguous; contract bundles with H but operational reality may include ad-hoc visiting-team direct sales per Kevin's spec. Either-or-both billing.

---

## 3. STL-FL specifically (promotion to fee account)

### 3.1 Contract says: FLAT FEE

**Pure flat fee per `JUPITER/KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.pdf`, Section 2(a).** No per-meal pricing in the contract.

Quote (Section 2(a)):
> Total Annual Fee: The total annual fee payable to Contractor for the Florida Services is $2,300,000 (the "Total Annual Fee"), which consists of the following:
> i. $1,400,000 for the Florida Services, payable in quarterly installments on the following dates: November 1, 2025; February 1, 2026; May 1, 2026; August 1, 2026, and In accordance with Section 2(c) hereof for 2027.
> ii. $900,000 as the budget for the cost of food, packaging, and supplies. Contractor will provide the Cardinals with bi-monthly invoices for these expenses, in addition to receipts, and at no time will charge more than the exact costs for said items.

### 3.2 Current technical state (live probe)

```
accounts:
  team_key: STL - FL
  name: St Louis Cardinals
  level: PDC                <-- flag
  billing_model: flat_fee   <-- matches contract
  region: East
  active: true

sc_homestand_schedule rows: 0   <-- this is the key trip
sc_services (active, not deleted): 11
all 11 services priced $0.00 effective 2026-06-16  <-- Joe's price review zeroed them all
```

The 11 active services: Breakfast - ST (×2), Arrival, Fun Money allocation (flat-fee non-revenue), Lunch - ST (×2), Pre-game, Breakfast, Post-Game, Lunch, Snack. All $0.

**What this means today:**
- `billing_model=flat_fee` is correct per contract.
- `level=PDC` is correct per geography (Jupiter is a PDC spring-training facility; Roger Dean Stadium hosts Cardinals + Marlins MiLB Spring Training and the Palm Beach Cardinals A-Single-A regular season).
- The current SC calendar treats STL-FL as **per-meal display** because the `isFeeAccount` gate requires BOTH `billing_model=flat_fee` AND `homestandMap` to be non-empty - STL-FL has zero homestand rows so falls through to per-meal.
- The per-meal services exist but priced at $0 - operationally tracking-only, not billing.

### 3.3 What changes if STL-FL is promoted to a true fee account

#### A. Database state changes

- `accounts.billing_model = 'flat_fee'` is already correct - no change.
- `accounts.level = 'PDC'` - **could stay or could change.** Spring training facilities are PDC-level regardless of billing model; the contract is for a PDC site. Recommend keeping `level=PDC` because the codebase's `categoryLabel()` translates PDC into the calendar's "PDC" category for the user-facing chip + dropdown grouping, and STL-FL is a PDC operationally.

#### B. Calendar display gate logic

The current calendar fee-display gate is:
```js
const isFeeAccount =
  data?.account?.billingModel === "flat_fee" && !!data?.homestandMap;
```

(`ServiceCalendar.js:200-201`)

The corresponding backend gate at `serviceCalendar.js:521`:
```js
const hasHomestandData = Object.keys(homestandMap).length > 0;
// ... and later:
if (billingModel === "flat_fee" && hasHomestandData) { /* fee classify branch */ }
```

This gate works for the 4 MLB fee accounts because MLB seasons have natural homestand structure that `sc_homestand_schedule` was seeded for. **PDC spring training doesn't have homestand structure** - the schedule is a series of camp blocks (MLB ST, MiLB ST, Extended ST, ASL, Fall Instructs, FYP Camp). Promoting STL-FL to fee display has two paths:

- **Path A: Seed `sc_homestand_schedule` for STL-FL** with PDC-appropriate day_types (e.g. CAMP/PREP/OFF) matching the camp-block calendar. The existing schema (`sc-2-homestand-schedule.sql`) constrains `day_type IN ('GAME', 'PREP', 'OPEN', 'CLOSE', 'CLEAN')` - none of which fit PDC camp days cleanly. Would need a schema relax + a new day_type vocabulary.
- **Path B: Add a separate fee-display gate** that doesn't require `homestandMap`. e.g. introduce `accounts.fee_display_mode = 'homestand' | 'period' | 'none'` and treat `period` as "fee account but no game-by-game structure". The calendar would show "Quarterly fee tier active" / "Off-season" caption-style states rather than the homestand-driven dot grid.

Path B is cleaner because (a) it doesn't conflate "scheduled game" semantics with PDC camp days, (b) it gives STL-FL its own display mode rather than forcing it into MLB scaffolding, (c) it extends naturally to other future PDC fee accounts.

#### C. Code-side STL-FL references that touch fee/homestand logic

`grep "STL.*FL\|hasHomestandData" src/`:

- `src/lib/dataStore/serviceCalendar.js:515-655` - 4 comment references and 4 gate uses of `billingModel === "flat_fee" && hasHomestandData`. **All of these would need their gate adjusted if STL-FL gets fee display.** Today they implicitly let STL-FL fall through to per-meal classify.
- `src/app/service-calendar/ServiceCalendar.js:191-200` - the `isFeeAccount` derivation. Same gate logic at the JSX layer.
- `src/app/api/service-calendar/route.js:286-299` - the route comment explains STL-FL falls back to per-meal because `homestandMap` is empty. Also affected.
- `src/app/service-calendar/admin/AccountsOverview.js:81-83` - the admin overview's fee-account detection uses `billingModel === "flat_fee" && level === "MLB"` to identify the 4 MLB fee accounts. **STL-FL is intentionally excluded from this; it shows as per-meal in the overview today.** Promoting STL-FL changes this list.
- `src/lib/incidentSchema.js:141` - just a label, no logic impact.
- `src/lib/stampInvoice.js:37` / `src/lib/drive.js:53` - just account code parsing, no logic.
- `src/lib/dataStore/invoice.js:150` - just a mapping, no logic.

**Net: 3 surfaces actually carry the fee-vs-per-meal logic** (`dataStore/serviceCalendar.js`, `app/service-calendar/ServiceCalendar.js`, `app/service-calendar/admin/AccountsOverview.js`) and one is comments only (route.js). All three would need the gate widened to accept STL-FL into the fee path without requiring a homestand schedule.

#### D. Per-meal price data once promoted

The 11 STL-FL services priced at $0 (effective 2026-06-16) become operationally irrelevant once STL-FL is fee-billed. **Recommend the promotion stage either: (a) deactivate the services (set `active=false`) so the editor doesn't surface them, or (b) leave them active but the fee-display calendar doesn't reference per-meal prices anyway, so they're inert.** Option (a) is cleaner.

---

## 4. TXR-TX-V (mirror confirmation)

### 4.1 Contract reality

**Same contract as TXR-TX-H.** The $604,032 flat annual fee covers BOTH home + visitor clubhouse food service. The visitor clubhouse scope per Section 1(b) is explicit: "in the visitors' clubhouse, Contractor agrees to provide: Grab & Go Snack options made by Contractor; packaged snacks, condiments, and beverages; and coffee service." **No buffet, no MTO, no per-meal billing.**

The user's hint that "TXR-TX-V revenue is sales-based, tracked in Season Tracker today, NOT a clean flat fee" is consistent with this gap: the visiting team direct-sales revenue (when KitchFix sells a buffet to a visiting team's traveling-secretary order) is a separate business flow NOT covered by the Rangers contract. The Rangers contract pays for the snack/coffee service for the visitor clubhouse; the visiting-team buffet meals are a separate sale-and-invoice between KitchFix and the visiting club.

### 4.2 Is mirroring TXR-TX-H for TXR-TX-V a reasonable stopgap?

**Yes for now, with flags.** The Service Calendar today shows TXR-TX-V with the same per-meal service catalog as TXR-TX-H (Breakfast, Lunch, Post-Game, Umpire all at $25.95). Per the contract this is overstated for the Rangers-billed side and understated for the visiting-team-sales side.

**Material billing-rate difference between H and V?** No, because they're not the same billing model. H is part of $604,032 flat fee (covered). V splits into:
- The G&G/snack/coffee piece, which IS part of the same $604,032 (covered).
- The visiting-team direct-sales piece, which is per-meal but at rates that depend on which visiting club is ordering and what's negotiated. Not in any contract in the package.

**What makes mirroring actively wrong:**
- If/when Stage 2's "future-dated price change" mechanic is used to update TXR-TX-V prices and the calendar's revenue compute treats those as billed rates, the calendar's revenue will be FOR the wrong billing relationship (showing $25.95 × visitor counts as Rangers revenue, when it's neither - it's visiting-team direct-sales revenue).
- The fee schedule build needs to ensure TXR-TX-V's fee row does NOT double-count the $604,032 already allocated to TXR-TX-H.

**Recommendation:** Stage 2 mirroring is OK. Fee schedule build must:
1. Allocate the full $604,032 to TXR-TX-H (or split it if Kevin wants H/V to each carry a portion in reporting).
2. TXR-TX-V either gets a $0 fee row with a `note='covered by H contract'` flag, OR gets a separate "direct-sales tracking" mode that records per-visiting-team revenue without ever being billed to the Rangers.

Either way: **don't bill both H and V from the same flat fee.**

---

## 5. Fee schedule - design implications

### 5.1 What the simple-case fee schedule needs

For STL-MO, CIN-OH, TXR-TX-H (the clean-flat-fee accounts), an effective-dated fee table needs:

| Column | Notes |
|---|---|
| `account_key` | one of the fee accounts |
| `amount` | the annual base fee (e.g. $604,032) |
| `effective_date` | start date for this amount (CPI escalators create new rows annually) |
| `period_type` | `annual` for these accounts |
| `payment_cadence` | `monthly-6` (STL-MO, CIN-OH 2026+, TXR-TX-H) or `monthly-7` (CIN-OH 2025) - how the annual is split |
| `payment_start_date` | first installment due date |
| `reason` + `created_by` + `created_at` | audit (mirrors sc_service_prices pattern) |

This gets you the basics: annual amount per fee account, effective-dated so CPI bumps create new rows, payment cadence so the calendar can show "next installment due X".

### 5.2 What the simple model MISSES (real complexity to design for)

These don't fit a single-amount-per-row table:

1. **STL-FL multi-line-item structure.** $1.4M base in QUARTERLY installments + $900K food passthrough invoiced BI-MONTHLY + $15K + $4K + $11K annual upkeep. That's 5+ distinct line items with 3 different payment cadences. A single "annual amount" row hides the food-passthrough split, the upkeep components, and the bi-monthly cadence.

2. **Post-season add-ons.** CIN-OH at $4,413.58/game + $2,206.79/workout-day. STL-MO at $5,222.22/game + $2,777.78/workout + $600 Road Food. Per-game rates that fire conditionally if the team makes the postseason. Need a `fee_add_on` table keyed on `(account, scenario)` with rate + qualifying-event.

3. **CPI escalators.** Each contract has different CPI mechanics:
   - CIN-OH: CPI Aug-to-Aug, floor 1%, cap 4%
   - STL-MO: CPI Aug-to-Aug, no floor/cap
   - TXR-TX-H: no CPI, direct 10% YoY built into next year's contract
   - STL-FL: inherits STL-MO's CPI via amendment co-term
   - CIN-AZ: CPI Oct base, floor 2%, cap 5%
   - TXR-AZ: 2.5% fixed annual
   - TBR-FL: ~~75% of CPI Nov-to-Nov~~ **[WITHDRAWN 2026-08-11 - UNVERIFIED per REF-129 §B.4]**
   - TBJ-FL: CPI, one increase per year, Provider-initiated

A `fee_schedule` table that just stores effective-dated amounts works fine if Kevin/admin manually creates the new row each year. Modeling the escalator formula in DB is overkill for a small portfolio.

4. **STL-FL 2027 work-stoppage standby fees** ($350K full / $175K half-standby). Conditional and date-bounded. Probably out of scope for v1 fee schedule; track in `notes`.

5. **TBR-FL service-fee amortization mechanic.** The $382,448 MiLB Service Fee was a 2024 one-time front-load; MiLB per-meal rates have a 25% discount applied "during the Term" to amortize the fee. The Service Fee may or may not renew for 2026 - flagged in `SC_CONTRACT_BILLING_SUMMARY.md:288`. Doesn't fit the "annual flat amount" model at all.

6. **TBJ-FL favored-pricing (MFN) constraint.** Any price discount to another account could retroactively trigger TBJ rate reductions. Not a fee-schedule concern directly, but the admin pricing UI should surface a warning when editing per-meal rates ANY account if TBJ-FL is in the system, "You're setting CIN-KY Breakfast to $X. TBJ-FL has an MFN clause and bills at $Y for the equivalent service. Triggering an MFN reduction notification?" Kevin's call - flag.

### 5.3 Recommendation: design for these accounts, not all

For the **fee schedule v1**, design for STL-MO, CIN-OH, TXR-TX-H, STL-FL (4 accounts that are 80% of the value). For STL-FL specifically, plan for the multi-line-item structure (base + passthrough + upkeep) rather than a single annual amount.

TXR-TX-V is bundled (rolls into TXR-TX-H's row, $0 marker).
TBR-FL's Service Fee mechanic is genuinely complex - leave it as per-meal for v1, revisit when the 2026/2027 SOW state is clarified with Kevin.
CIN-AZ has an unknown amendment situation - shouldn't be in the fee schedule until the operative 2026 pricing is in hand.

### 5.4 Accounts that fit the simple effective-dated flat-amount model

- **STL-MO**: yes, with post-season add-ons in a sibling table
- **CIN-OH**: yes, with post-season add-ons in a sibling table
- **TXR-TX-H**: yes (also covers V)

### 5.5 Accounts that DON'T fit cleanly

- **STL-FL**: needs multi-line-item (base + passthrough + upkeep) or 3 sibling rows
- **TBR-FL**: Service Fee is non-recurring; doesn't model as effective-dated
- **TXR-TX-V**: structurally separate billing (direct sales), needs its own surface

---

## 6. Calendar revenue vs contract billing

### 6.1 The current calendar's revenue compute

The per-day calendar tile revenue is computed JS-side as `actual_count × current_price`. The DB view computes per-(account, service, date) revenue against the effective-dated price. For per-meal accounts, this maps to actual billing 1:1.

### 6.2 For fee accounts, the disconnect

The 4 MLB fee accounts have all per-meal prices set to $0 in the database (verified live). So `actual_count × $0 = $0` revenue everywhere. The fee accounts' actual billing comes from the contract's flat fee, paid as installments per a schedule.

**Once the fee schedule exists**, fee account revenue should come from the fee schedule's monthly/quarterly installment, NOT from meal counts × prices. The calendar should show:
- Per-day: just the operational data (game scheduled, meals delivered, no $ figure)
- Per-month: the installment due that month + (optional) accrued-day cumulative
- Per-year: the annual fee total

### 6.3 Anything in the contracts that makes "fee revenue from fee, not from meals" wrong?

**No - all 4 MLB fee contracts cleanly separate operational meal counts from billed revenue.** Specifically:

- **CIN-OH** (`SC_CONTRACT_BILLING_SUMMARY.md:133-144`): "Hybrid (flat Services Fee + reimbursed Food/Supplies + reimbursed Clubhouse Extras)." Reimbursement is at-cost passthrough invoice, NOT per-meal billing. So fee revenue = flat fee + reimbursed costs, neither of which is a `meals × rate` compute.
- **STL-MO**: pure flat fee. No per-meal billing exists.
- **TXR-TX-H**: pure flat fee. No per-meal billing exists. Postseason is pro-rata Services Fee.
- **STL-FL**: pure flat fee + food passthrough. No per-meal billing exists.

**The food passthrough lines (CIN-OH $X, STL-FL $900K budget, STL-MO $225K budget) are reimbursed at cost** - so they're revenue to KitchFix only in the same dollar amount as KitchFix's spend on those items. Net-zero from a margin perspective; from a revenue perspective they're billed and collected but pass through to suppliers. For the calendar's "revenue YTD" KPI, **the passthrough lines should either be excluded entirely (only count the Services Fee portion) or counted as gross revenue with a note**. Recommend excluding to avoid inflated topline.

### 6.4 Contract-language confirmation

CIN-OH 2025-26 contract, Section 2(b) (verbatim):
> Cost of Food and Disposable Supplies. Prior to March 1st, the Reds shall provide Contractor with a budget for food and disposable supplies to prepare and serve the Meals. Contractor will order all such food and disposable supplies, will invoice the Reds in accordance with Section 2(d) and will maintain detailed books and records, in form and substance satisfactory to the Reds, for expenditures for food and disposable supplies. Contractor is responsible to keep Reds informed of the budget throughout the year. Contractor is not liable and will be reimbursed for any cost of food and disposable supplies over and above the budgeted amount(s).

STL-MO 2025-27 contract, Section 2(a)(iii) (verbatim):
> $225,000, as the budget for the cost of food, packaging, and supplies. Contractor will provide the Cardinals with monthly updates on budget tracking, but Contractor is not responsible for ensuring the budget limit. Any additional requests, changes in scope, or ingredient modifications may result in costs exceeding the budget estimate. Any savings realized will be solely the Cardinals' benefit.

**These are not per-meal billed; they are at-cost reimbursements. The calendar should compute fee revenue from the Services Fee component only, not from `meal_count × derived_rate`.**

---

## Gaps - couldn't confirm from contracts/repo

1. **TBJ-NY (Buffalo Bisons)** - no contract in the package. Per-meal projections in spreadsheet ($27.34/meal) are assumption-only. Need a Bisons contract or written confirmation of the operating model.
2. **CIN-AZ operative 2026 pricing** - the 2023 contract on file is in Renewal Term, but the spreadsheet $29.01 MLB Breakfast is ~62% above the 2023 base + max CPI - an amendment exists out-of-band that isn't in the package.
3. **TXR-AZ 2026 SOW** - 2025 SOW only in package. 2026 deposit amount and any new pricing tiers (Continental Breakfast, MLB Dinner, Extra Protein) aren't sourced.
4. **TBR-FL 2026/2027 Service Fee renewal status** - the MiLB Service Fee was a 2024 one-time amount with two installments. Whether it renews each year or rolls off is unstated.
5. **TBR-FL "B&G" (Boys & Girls Club) separate revenue stream** - $6.50/lunch, not in any SOW. Needs written agreement.
6. **CIN-AZ Exhibit B volume threshold** - reading shows MiLB rates DROP to $16.22 after 72,890 meals - which is HIGHER than the $11.35 base. Reads as a typo or pricing-tier construct (flag from `SC_CONTRACT_BILLING_SUMMARY.md:69`).
7. **Live state of TBJ-FL "Stadium Staff Meals / Media Meals / Team Canada / Fun $$$$"** - in spreadsheet but not in 2023 SOW #1. Could be later SOWs or operational additions.
8. **STL-FL homestand vs camp-block calendar structure** - the existing `sc_homestand_schedule` table doesn't have day_types appropriate for PDC camp blocks. Need product call on Path A (extend day_types) vs Path B (separate fee-display mode for non-homestand accounts).

---

## My read - which accounts to design for, which to defer

**Build the fee schedule v1 around the simple cases:**
- **STL-MO** - clean flat fee with CPI + postseason add-ons. Sets the pattern.
- **CIN-OH** - same shape, slightly different installment schedule. Validates the pattern.
- **TXR-TX-H** - simplest (single-year flat fee, no CPI). Easy win. (V bundled to H with `$0` marker + note.)
- **STL-FL** - the complex case worth tackling: multi-line-item (base + passthrough + upkeep) tests the schema. Either the schema accommodates this or it doesn't, and the answer informs whether the architecture is right.

**Defer to a later stage:**
- **CIN-AZ** - missing amendment for 2026 pricing; don't model what you don't have.
- **TBR-FL** - non-recurring MiLB Service Fee + two parallel SOWs + amortization mechanic. Different architecture. Wait for clearer SOW-renewal state.
- **TBJ-FL / TBJ-NY** - per-meal hybrid + MFN clause + missing Bisons contract. Per-meal stays as-is for now.
- **TXR-AZ** - per-meal with deposit-discount. Per-meal stays as-is for now; 2026 SOW needs to land first.

**The biggest design risk** is treating "fee account" as a binary when STL-FL needs a non-MLB-homestand fee display. Either widen the homestand model to support PDC camp blocks, or introduce a parallel display mode for fee accounts without game-day structure. The choice shapes the fee schedule's UX as much as its schema.

End of report.
---

## RESOLUTIONS (June 2026 - from the lens-vision investigation)

The open questions this doc previously flagged are now resolved. Recorded here so they are not re-investigated.

### CIN-AZ pricing - RESOLVED
The doc flagged that the 2026 spreadsheet price (~62% above the 2023 base + max CPI) implied a missing out-of-band amendment. Kevin's answer: **the pricing in the SC spreadsheet IS the agreed pricing.** The actuals total is what is charged the client, apart from the service fee, which is billed separately. The spreadsheet is authoritative for billing; there is no missing document blocking the build. Actuals prices are 70% of projected (a contracted discount baked into the Actuals tab).

### TBR-FL 25% MiLB amortization discount - RESOLVED (empirically)
The doc flagged that whether the 25% discount renews for 2026/2027 was unstated. **Empirical answer from the 2026 spreadsheet: the discount IS still applied in 2026.** MiLB Actuals-tab prices are exactly 75% of Projections-tab prices (in two forms: a direct multiplier on AFTER HOURS MEALS + Dinner, and a service-rename where MiLB-ST services become non-ST at 75% of the ST price). Major League services show 0% delta (no discount, per contract). `archive/SC_PRICE_COMPARISON.md` (archived 2026-07-17) independently confirms the negative delta. For the tool's math, TBR-FL 2026 actuals revenue uses the discounted prices and the new tool must reproduce that to match the P&L. NOTE: the contract Term reconciliation (is 2026 legitimately inside the discount Term, or is ops applying a stale discount?) is HOUSEKEEPING for Kevin to confirm with the SOW - it does not block the build, since the tool matches what is actually billed either way.

### STL-FL flat-fee spread - RESOLVED
The doc / clarify-list asked how STL-FL's $1.4M flat fee maps onto a time-unit view. **Answer from the 2026 P&L (confirmed against actuals through P6): the fee is PHASE-AWARE PRORATED, not flat-monthly or flat-quarterly.** Per-period: P1 $45,553, P2 $171,367, P3 $407,375 (ST peak), P4 $132,755, P5-P9 $98,915 each (FCL plateau), P10 $57,267, P11 $52,061, P12 $39,046, P13 $0. Total $1,400,000. ALL flows through `2400.1 Meal Service (Home)` - no Catering, no Service Charges line. The SC financial frame for STL-FL drives period revenue from this allocation, NOT from per-meal price x count (STL-FL per-meal prices are $0 by design as of the 2026-06-16 flip).

### Passthrough / Service Charges in the topline - RESOLVED
The doc recommended considering excluding cost-passthrough from the revenue KPI. **Answer from the actuals P&L: Service Charges is a SEPARATE revenue line that IS included in the P&L topline** (CIN-AZ P3 example: Meal Service $320,184 + Service Charges $115,234 + Catering = Total Revenue). It is not netted out. Decision: the SC's KPI revenue push includes Service Charges (matches the P&L, which is what operators compare against). The SC already computes both the meal-service revenue and the service-charge component, so it pushes the same three-line breakdown the P&L uses. If a "true margin" KPI is ever wanted, surface Service Charges separately and subtract on demand - but the default matches the P&L topline.

### The confirmed revenue model (all accounts)
Three revenue lines, consistent across the SC sheets, the budget P&Ls, the actuals-through-P6, and the legacy KPI tool: `2400.1 Meal Service (Home)`, `2300 Service Charges`, `2200 Catering Revenue`. `2400.2 Meal Service (Away)` exists in the template but is unused across all accounts. See `SC_KPI_PUSH_CONTRACT.md` for how this band pushes to the dashboard.

---

## PRICING-FIX shipped (sc-8a + sc-8b)

The data-correctness bug this doc's resolutions referenced (live `sc_daily_revenue` multiplied both `projected_count` and `actual_count` by the same single sticker price, overstating CIN-AZ actuals by ~43% and TBR-FL MiLB actuals by ~33%) is now fixed at the schema + view layer.

**What changed:**

- `sc_service_prices` gained a `price_kind TEXT NOT NULL DEFAULT 'projected'` column with CHECK `('projected','actual')`. The UNIQUE constraint upgraded from `(service_id, effective_date)` to `(service_id, effective_date, price_kind)`. Index reshaped to `(service_id, price_kind, effective_date DESC)`. (`docs/migrations/sc-8a-price-kind-column.sql`.)
- `sc_daily_revenue` forked its single price LATERAL into TWO per-kind LATERALs. `projected_revenue = projected_count * pr_proj.price`. `actual_revenue = actual_count * COALESCE(pr_act.price, pr_proj.price, 0)` so non-discounted accounts and skip-predicate services (flat-fee, tax-free) safely fall back to the projected price for actuals. Two columns added (`actual_price_at_date`, `actual_price_effective_date`); `price_at_date` kept its name and semantic (planning price) so the route response shape is unchanged. (`docs/migrations/sc-8b-actual-prices-and-view.sql`.)
- `dataStore/serviceCalendar.js` reads `sc_service_prices` with `.eq("price_kind","projected")` everywhere it consumes the planning rate (the per-account config loader, the all-accounts admin loader). Admin upsert + new-service insert tag rows with `price_kind: 'projected'`. The actuals/billing price is not editable from the admin surface today; the discount map seeds it via the backfill.

**The discount map used by the backfill** (extracted from the legacy spreadsheets, cross-checked against the contract docs - see the discount-map recon report):

| account | scope | factor | source |
|---|---|---|---|
| CIN - AZ | all groups | 0.70 | 30% off (matches the Service Charges line on the CIN-AZ P&L) |
| TXR - AZ | all groups | 0.80 | 20% Annual Deposit discount |
| TBR - FL | Minor League only | 0.75 | 25% MiLB amortization discount (Major League is NOT discounted; community group Boys & Girls Club is not a contracted PDC scope) |
| TBJ - FL, CIN - KY, TBJ - NY | per-meal | 1.00 | no contracted discount; view's COALESCE fallback handles them with no backfill rows |
| STL - FL, CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V | n/a | n/a | flat-fee revenue from `sc_fee_schedule`; out of scope for per-meal pricing |

**Skip predicate within a discounted account**: services with `is_flat_fee = true` OR `is_tax_free = true` are not discounted - they pass through at factor 1.00. The backfill omits them (no `actual` row inserted); the view's COALESCE fallback applies the projected price. This covers CIN-AZ's Coffee Service + Fountain Bev (tax-free beverages), TBR-FL's Extra Protein / MLB Extra MTO / Road Sandwiches (flat-priced add-ons), and TXR-AZ's flat-fee items.

**Verification gate** (run after `sc-8b` applies; passing is required for the migration to be considered done): CIN-AZ period 3 (2026-02-23 to 2026-03-22) `SUM(actual_revenue)` lands within a few percent of $320,184 (the P&L 2400.1 Meal Service line); pre-fix the live view returned $467,311. Sample day 2026-03-13 actual_revenue drops from $20,580 to ~$14,406. TBR-FL Minor League actuals bill at 0.75; TBR-FL Major League continues at 1.00. Projected revenue is unchanged for every account. TBJ-FL / CIN-KY / TBJ-NY actuals are unchanged (factor 1.00 via fallback). Flat-fee accounts are untouched. Full verification table in the PR body.
