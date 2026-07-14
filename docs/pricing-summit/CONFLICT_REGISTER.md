# CONFLICT REGISTER — Pricing Summit Evidence Gather

> Read-only register. Every entry is A-vs-B verbatim (or "SILENT" where sources are silent). **No resolutions — Kevin rules at the summit.** Numbering: A-* live conflicts, B-* rate-table gaps, C-* paperwork gaps confirmed, D-* documentation corrections, E-* items intentionally NOT flagged (per Kevin's rulings context).
>
> Cross-references: EVIDENCE_&lt;ACCOUNT&gt;.md × 11 (this PR) + `docs/SC_MONEY_MODEL.md` + `docs/SC_CONTRACT_BILLING_SUMMARY.md`.

---

## A. Live conflicts (Kevin rules)

### A-1. TBR - FL MiLB Lunch/Dinner rate — DIGEST vs INVOICE ($0.72/meal delta)

- **Source A** (`docs/SC_MONEY_MODEL.md` Per-account digest, line for TBR - FL): "Post-SF invoice MiLB $20.96 MiLB"
- **Source B** (Invoice K300168871, dated 2026-07-05, line items 6/29-7/4): `TBR MiLB - Lunch/Dinner` unit rate **$21.68**, applied to 6 days of MiLB service
- **Delta**: $0.72/meal above digest
- **Contract basis**: 2024 MiLB Post service-fee Lunch/Dinner Rate $19.40 (Minor League SOW § 6(a)(iv) p.5); with 75% × CPI-U Food Away from Home escalation to 2026, actual escalated rate is $21.68 per QB, not $20.96 per digest
- **See**: EVIDENCE_TBR-FL.md §7

#### A-1 recompute addendum (2026-07-14 micro-task)

**Verdict: NEAR MISS on BOTH sides — digest and invoice each fail to derive cleanly from the contract's escalation clause. Neither is the contract-correct rate.**

##### Contract facts (verbatim, from EVIDENCE_TBR-FL.md §2)

- **2024 Base Lunch/Dinner Rate** (Minor League SOW § 6(a)(ii) p.5): **$25.86**, "not inclusive of tax"
- **2024 Post service-fee Lunch/Dinner Rate** (§ 6(a)(iv) p.5): **$19.40**, "not inclusive of tax"
- **SF discount** (§ 6(c) p.6): "The Rates will be reduced by **25%** for all billings for the Minor League Baseball Teams within the Term." Verified: $19.40 / $25.86 = 0.7501 → 25% discount applied post-sticker.
- **Escalation clause** (§ 6(a)(v) p.5, verbatim):
  > "For each year of the SOW Term after 2024, each Breakfast Meal prepared by the Provider in accordance with this SOW for the Minor League Baseball Teams shall be at the rate of the 2024 Base Breakfast Rate and the rate of the 2024 Post service-fee Breakfast Fee, as the case may be, as adjusted upward or downward by a percentage equal to **seventy-five percent** of the percentage change in the 'CPI Index'"
- **CPI Index definition** (Major League SOW § 6(i)(c) p.5, cross-applied to MiLB per § 6(a)(v)):
  > "CPI Index shall refer to the Consumer Price Index for All Urban Consumers (CPI-U): U.S. City Average, Food Away from Home – Full Service Meals and Snacks, as calculated by the United States Department of Labor, Bureau of Labor Statistics (CPI)."
- **Reset cadence** (same § 6(i)(c) p.5):
  > "For purposes of this SOW, the adjustment in rate, if any, for 2025 shall be based upon the change from the November 2024 CPI Index to the November 2023 CPI Index (with the same procedure to be followed for each year of the Term after 2025)."

##### BLS-published CPI values

Series: **CUUR0000SEFV01** = "CPI-U U.S. City Average - Food away from home - Full service meals and snacks", Not Seasonally Adjusted. Source: BLS Public API `https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SEFV01` (fetched 2026-07-14).

| Month | Index value |
|---|---:|
| November 2023 | **221.574** |
| November 2024 | **229.554** |
| November 2025 | **239.371** |

YoY changes:

- Nov 2023 → Nov 2024: (229.554 − 221.574) / 221.574 = **3.6015%**
- Nov 2024 → Nov 2025: (239.371 − 229.554) / 229.554 = **4.2766%**

Contract escalator (75% × YoY):

- 2025 escalator: 0.75 × 3.6015% = **2.7011%**
- 2026 escalator: 0.75 × 4.2766% = **3.2074%**

Reference (NOT the contract-cited series — for completeness): generic CUUR0000SEFV "Food away from home" gave Nov 2023 = 360.383, Nov 2024 = 373.530, Nov 2025 = 387.202 (YoY 3.6482% then 3.6602%). Slightly different figures; contract explicitly cites the sub-index (SEFV01), not the parent (SEFV).

##### Computed 2026 rate — every interpretation of the clause

All computations start from the contract 2024 post-SF Lunch/Dinner rate of $19.40 (the clause escalates the base and post-SF rates independently per "as the case may be").

**Method (b) — contract-correct: compound YoY, 75% × contract-cited CPI**

    2025 post-SF = $19.40 × (1 + 0.027011) = $19.9240
    2026 post-SF = $19.9240 × (1 + 0.032074) = $20.5631

→ **Contract-correct 2026 rate = $20.56.**

**Method (c) — cumulative from 2024 base, 75% × contract-cited CPI**

    Nov 2023→Nov 2025 cumulative CPI: (239.371 − 221.574) / 221.574 = 8.0321%
    75% × 8.0321% = 6.0241%
    2026 post-SF = $19.40 × 1.060241 = $20.5687

→ $20.57 (rounds the same as Method b; +$0.006 difference is a compounding-order artifact).

**Method (d) — DROP the 75% multiplier, compound YoY, contract-cited CPI**

    2025 = $19.40 × 1.036015 = $20.0987
    2026 = $20.0987 × 1.042766 = $20.9582

→ **$20.96 EXACT MATCH to PG/digest**.

**Method (e) — 100% CPI, compound YoY, GENERIC CUUR0000SEFV (not contract-cited)**

    2025 = $19.40 × 1.036482 = $20.1077
    2026 = $20.1077 × 1.036602 = $20.8437

→ $20.84 (not a match).

**Method (f) — sticker-first (escalate $25.86 sticker), 100% CPI, then apply 25% discount to escalated sticker**

    2025 sticker = $25.86 × 1.036015 = $26.7913
    2026 sticker = $26.7913 × 1.042766 = $27.9371
    2026 post-SF = $27.9371 × 0.75 = $20.9528

→ $20.95 (rounds to $20.96 same as Method d).

##### Delta table vs invoice-observed $21.68

| Method | Contract fidelity | 2026 rate | Delta vs invoice | Explains what |
|---|---|---:|---:|---|
| **(b) contract-correct** | 100% faithful to clause | **$20.56** | **+$1.12 (+5.43%)** | Neither digest nor invoice matches contract |
| (c) cumulative | 100% faithful (arithmetic variant) | $20.57 | +$1.11 (+5.40%) | Same as (b) |
| **(d) drop-75% compound** | drops the "seventy-five percent" | **$20.96** | +$0.72 (+3.44%) | **Exact match to PG/digest** |
| (e) generic-index compound | drops both 75% AND uses wrong index | $20.84 | +$0.84 (+4.01%) | Not a match |
| (f) sticker-first drop-75% | drops the 75%, sticker-order variant | $20.95 | +$0.72 (+3.47%) | Same as (d) modulo rounding |

##### Findings

1. **PG/digest $20.96 = Method (d)**: the digest was computed using the contract-cited index but **dropped the "seventy-five percent of" multiplier** from the escalation clause. It applied 100% of the CPI change instead of 75%. This is a **derivation bug in the digest source (Price Review v3 or its downstream)**.

2. **Invoice $21.68 does NOT match any interpretation** of the escalation clause. Excess vs the contract-correct Method (b) rate = **$1.12/meal (+5.43%)**. Excess vs the digest's dropped-75% rate = **$0.72/meal (+3.44%)**. No CPI-based reading (contract-cited or generic; compound or cumulative; sticker-first or post-SF-first) produces $21.68 from the $19.40 base.

3. **The $0.72 residual** between digest and invoice cannot be explained by CPI arithmetic. Most likely candidates (evidence-only, Kevin rules):
   - **Manual rate override in QB**: Sebastian set a rate not derived from the escalation formula.
   - **Unseen 2026 SOW amendment**: a 2026-specific rate update between Kevin and the Rays not present in the executed 2024 SOW file. Would parallel the missing 2026 SOWs at CIN-AZ (C-1) and TXR-AZ (C-3).
   - **Add-on baked into per-meal rate**: labor, packaging, or other ancillary rolled into the meal rate rather than a separate line item. (Note: same invoice K300168871 does bill Labor Fee $280 and Road Sandwiches $15 as separate lines, so this reading is weak.)
   - **Different multiplier factor applied**: e.g., 100% CPI plus a 3.44% administrative uplift. 3.44% isn't a clean number; unlikely.

4. **Neither the digest nor the invoice matches the contract-correct rate.** The digest is a formulaic error; the invoice source is unidentified without further evidence.

##### A-1 disposition

**NEAR MISS on both sides.** Contract-correct 2026 rate per verbatim clause + published BLS data = **$20.56**. Digest $20.96 = contract-cited index applied at 100% (dropped the 75% multiplier). Invoice $21.68 cannot be derived from any interpretation of the escalation clause; residual +$0.72 above digest is unexplained.

**Rulings needed from Kevin at the summit** (do NOT apply anything now):
1. Which is the source of truth — the executed contract (rate $20.56), the digest ($20.96), or the operator-set invoice ($21.68)?
2. Is there an unseen 2026 SOW amendment / operator-agreed rate memo for TBR-FL that would justify $21.68?
3. If the contract stands, backfill: fix PG effective-dated to $20.56 (queued for Phase 3), refund/credit for over-billed 2026 meals to date.
4. If the invoice stands, execute a written amendment covering the 3.4% uplift over the escalation formula.

##### Sources cited

- Contract: `/Users/kevinfietek/Documents/Claude /Contracts/TBR FL/Minor League SOW 2024 EXECUTION Josh.pdf` § 6(a)(ii), § 6(a)(iv), § 6(a)(v), § 6(c) p.5-6.
- Contract: `/Users/kevinfietek/Documents/Claude /Contracts/TBR FL/Major League SOW 2024 EXECUTION Josh.pdf` § 6(i)(c) p.5 (defines CPI Index + cadence, cross-applied).
- BLS series `CUUR0000SEFV01` "Food away from home - Full service meals and snacks", All Urban Consumers, U.S. City Average, Not Seasonally Adjusted. Fetched from BLS Public API on 2026-07-14; values verifiable at `https://data.bls.gov/timeseries/CUUR0000SEFV01`.
- Invoice: `/Users/kevinfietek/Documents/Claude /Client Invoices/Invoice K300168871.pdf` dated 2026-07-05, TBR-FL MiLB meal service.
- Cross-refs: `docs/pricing-summit/EVIDENCE_TBR-FL.md` §2.1-2.5; `docs/SC_MONEY_MODEL.md` per-account digest row for TBR - FL.

### A-2. TBR - FL Service Fee 2026 renewal — CONTRACT SILENT vs MONEY_MODEL "2024 one-time"

- **Source A** (Minor League SOW § 6(c) p.6): The $382,448 Service Fee is defined with exactly two installments: "(A) On the first date that this SOW has been signed by both parties, the Club shall pay the sum of two hundred thousand dollars (USD $200,000.00), and (B) On or before February 1, 2024, the Club shall pay the sum of one hundred eighty-two thousand four hundred forty-eight dollars (USD $182,448)." Contract SILENT on whether the SF recurs in any subsequent Agreement Year.
- **Source B** (`docs/SC_MONEY_MODEL.md` §d + Open items 5): "$382,448 (2024 one-time front-load) ... Renewal status for 2026 unconfirmed"
- **Source C** (Invoice sample): NO 2026 SF billing observed in either TBR-FL invoice (K300168545 MLB + K300168871 MiLB) — both are pure per-meal.
- **Delta**: Contract silent = 2024-one-time is the paper record; MONEY_MODEL notes as "unconfirmed"; invoice sample supports one-time reading.
- **See**: EVIDENCE_TBR-FL.md §7 (chase C-2)

### A-3. TBJ - FL Service Fee cadence — MONEY_MODEL "monthly Jan/Feb/Mar" vs CONTRACT annual/silent

- **Source A** (Contract § 12(a) p.30): "annual service fee (the 'Service Fee') in the amount of Four Hundred and Fifty Two Thousand Eight Hundred and Twelve Dollars (USD $452,812), plus applicable taxes, for each SOW #1 Agreement Year during the Term." Contract § 12(e) covers weekly per-meal invoicing only; SF cadence not specified.
- **Source B** (`docs/SC_MONEY_MODEL.md` §d): "TBJ-FL $452,812/yr ... Split monthly Jan/Feb/Mar per ABR OneSheeter"
- **Delta**: MONEY_MODEL cites "ABR OneSheeter" as the cadence source; contract itself is silent on how the $452,812 is invoiced.
- **See**: EVIDENCE_TBJ-FL.md §5 + §11

### A-4. TBJ - FL FSL vs FCL rate merge — CONTRACT two tiers vs INVOICE/DIGEST single rate

- **Source A** (Contract § 12(b) p.30):
  - (ii) FSL Team Meals: "$14.50, plus applicable taxes, per Meal ... to those Minor League Players who, at the applicable time, are assigned by the Club to the FSL Team"
  - (iii) FCL Team Meals: "$10.14, plus applicable taxes, per Meal ... to those Minor League Players ... assigned by the Club to the FCL Team"
- **Source B** (Invoice K300168872): single line `TBJ MiLB - Breakfast/Lunch/Dinner` at $11.55/meal, no FSL/FCL distinction
- **Source C** (`docs/SC_MONEY_MODEL.md` digest): "MiLB Post-SF $11.55" (single rate)
- **Delta**: Contract distinguishes two MiLB tiers with different rates ($14.50 FSL / $10.14 FCL). QB invoice + MONEY_MODEL digest use a single flattened rate.
- **See**: EVIDENCE_TBJ-FL.md §11

### A-5. STL - FL upkeep-ownership — CONTRACT ambiguous vs MONEY_MODEL "KitchFix-borne"

- **Source A** (STL-FL Amendment § 2.b p.2):
  > "b. Ongoing annual upkeep expenses for the Florida Services:
  > i. $15,000/year equipment budget and/or potential repair budget of up to $15,000, which shall roll over if unused;
  > ii. $4,000/year for storage pod rental; and
  > iii. $11,000/year for temporary cooler storage (during Spring Training only) plus necessary electrical hook-ups."
- **Source B** (`docs/SC_MONEY_MODEL.md` §h fee schedule table for STL-FL): "Upkeep budgets ($15K equipment + $4K storage pod + $11K ST cooler) are KitchFix-borne expense/budget lines, not revenue - excluded."
- **Delta**: Contract wording ("Ongoing annual upkeep expenses for the Florida Services") is AMBIGUOUS on who bears them. The word "budget" earlier in § 2.a.ii ("$900,000 as the budget for the cost of food") means Cardinals-funded. Read literally, § 2.b would suggest Cardinals reimburse $30K/yr on TOP of the $1.4M SF. MONEY_MODEL asserts KitchFix bears them.
- **See**: EVIDENCE_STL-FL.md §5 + §11

### A-6. STL - FL invoice tax = $0 vs contract "subject to local sales tax"

- **Source A** (STL-FL Amendment § 2.d p.3): "Sales Tax: All figures provided are subject to local sales tax, which will be applied and itemized on each invoice." The $350K quarterly + $175K 2027-standby + all 2027 clauses in § 2.c say "plus applicable taxes".
- **Source B** (Invoice K300168343, dated 2026-07-01, "Service Fees (PFS)" line $350,000): **TAX 0.00** on the invoice. Line is NOT "T"-flagged.
- **Delta**: Contract requires tax itemization; invoice shows no tax on the $350K SF installment.
- **See**: EVIDENCE_STL-FL.md §9 + §11

### A-7. TXR - TX - V SC-models-buffet vs CONTRACT G&G-only scope

- **Source A** (Contract § 1.b p.1, TXR H&V shared contract): "Further, in the visitors' clubhouse, Contractor agrees to provide: Grab & Go Snack options made by Contractor; packaged snacks, condiments, and beverages; and coffee service."
- **Source B** (`docs/ACCOUNT_SERVICES_BRIEF.md` open item #25, line 684): "Visitor clubhouse contract scope is G&G + snacks + coffee only; SC models full buffet services. Decide whether to delete the buffet services or keep them as ad-hoc tracking."
- **Delta**: Contract explicitly limits visitor-clubhouse to G&G + snacks + coffee. SC models full buffet services for TXR-TX-V (mirroring TXR-TX-H). Pre-existing open item.
- **See**: EVIDENCE_TXR-TX-V.md §11

---

## B. Rate-table gaps (add to MONEY_MODEL digest)

### B-1. TBR - FL MLB Breakfast rate missing from digest

- **Source** (Invoice K300168545, 7 daily rows): `TBR MLB - Breakfast` @ **$35.63**
- **Digest currently**: TBR-FL MLB is a single "$39.48" column
- **Fix candidate**: split digest MLB into Breakfast ($35.63) + Lunch/Dinner ($39.48).
- **See**: EVIDENCE_TBR-FL.md §11

### B-2. TBR - FL MiLB Breakfast rate missing from digest

- **Source** (Invoice K300168871, 4 daily rows): `TBR MiLB - Breakfast` @ **$17.83**
- **Digest currently**: TBR-FL MiLB is a single "$20.96" column
- **Fix candidate**: split MiLB into Breakfast ($17.83) + Lunch/Dinner (rate ruled per A-1).

### B-3. TXR - AZ ancillary snack rates missing from digest

- **Source** (Invoice K300168870, 6 daily rows): `TXR-AZ - Pre-Game Hot Snack` @ **$10.93**; 1 row: `TXR-AZ - Regular Snack` @ **$5.89**
- **Contract basis**: SOW #1 2025 rates $10.66 + $5.74; × 1.025 = $10.93 + $5.88.
- **See**: EVIDENCE_TXR-AZ.md §11

### B-4. TXR - AZ MLB Dinner — PG has service, contract SOW #1 doesn't

- **Source** (PG dump): `MLB Dinner` service exists in PG at $28.58
- **Contract**: SOW #1 lists MLB Breakfast + Lunch only (no MLB Dinner rate)
- **Delta**: paperwork silent on MLB Dinner; PG populated. Possibly ancillary service defined elsewhere, or 2026 SOW would have added it.
- **See**: EVIDENCE_TXR-AZ.md §6 + §11

### B-5. TBR - FL add-on line items not in digest

- **Source** (Invoice K300168871): `TBR MiLB - Road Sandwiches` @ **$15.00** flat, qty 28-56/day; `Labor Fee` @ **$280.00**; `Extra Protein (TBR) - Chicken/Pork` @ **$111.84**
- **Digest currently**: no rows for these add-ons.
- **See**: EVIDENCE_TBR-FL.md §11

### B-6. CIN - AZ Coffee + Fountain rates in ACCOUNT_SERVICES_BRIEF but not MONEY_MODEL digest

- **Source A** (`docs/ACCOUNT_SERVICES_BRIEF.md` lines 66-67): "Coffee Service (tax-free) $511.05/wk"; "Fountain Bev (tax-free) $283.92/wk"
- **Source B** (Invoice K300168736): matching $511.05 + $283.92
- **Source C** (`docs/SC_MONEY_MODEL.md` digest): silent on beverage rates
- **Delta**: rates exist in ACCOUNT_SERVICES_BRIEF + PG + invoice; MONEY_MODEL digest table (§Per-account digest) doesn't include them.
- **See**: EVIDENCE_CIN-AZ.md §3.2 + §4

---

## C. Paperwork gaps CONFIRMED

### C-1. CIN - AZ 2026 SOW/amendment MISSING

- Confirms `docs/SC_MONEY_MODEL.md` Q4 open gap: "the SOW/amendment that CPI-escalated from the 2023 base ($17.88 / $11.35) to these numbers is not in the contracts folder."
- Only paperwork in `/Users/kevinfietek/Documents/Claude /Contracts/CIN AZ/` = 2023 base contract (Effective Jan 3, 2023).
- Operative 2026 rates ($20.31 / $12.90 post-SF; $29.01 / $18.42 sticker) tie back to Price Review v3 (Joe Lessard) not to any contract amendment.
- **Owner (Kevin)**: Ashley at the Reds is counterparty. Chase for 2027 renewal decision.

### C-2. TBJ - NY contract MISSING (Buffalo Bisons)

- Confirms `docs/SC_MONEY_MODEL.md` Q6 open gap.
- `/Users/kevinfietek/Documents/Claude /Contracts/TBJ NY/` folder is EMPTY.
- $27.34 rate in PG + MONEY_MODEL + workbook is assumption-only.
- **Owner (Kevin)**: chase for a contract or written confirmation of the operating model.

### C-3. TXR - AZ 2026 SOW MISSING

- Confirms `docs/SC_CONTRACT_BILLING_SUMMARY.md` Open item #4.
- 2025-2027 master agreement + SOW #1 (2025 only) present. NO 2026 SOW.
- 2026 rates and 2026 deposit amount are DERIVED via § 2.a's 2.5% escalation (which is unambiguous, but the paperwork should be memorialized).

### C-4. TXR - TX - H § 2(d) missing from contract

- Contract § 1.c p.1 says "within the budget set forth below in Section 2(d)" — but § 2 contains only (a) Services Fee and (b) Catering. No subsection (d) exists.
- **Kitchen setup budget amount UNKNOWN**.

### C-5. TBR - FL B&G (Boys & Girls Club) lunch rate MISSING

- Confirms `docs/SC_CONTRACT_BILLING_SUMMARY.md` Open item #6.
- $6.50/lunch B&G referenced in ACCOUNT_SERVICES_BRIEF / historic docs; NOT in the 4 TBR-FL contract PDFs on file.

### C-6. CIN - AZ Exhibit B $16.22 "tier" that's HIGHER than $11.35 base

- Confirms `docs/SC_CONTRACT_BILLING_SUMMARY.md` Open item #8.
- Verbatim contract text: "Meals will be billed at the following rates once a total of 72,890 meals have been billed in 2023: Breakfast - $16.22 per person / Lunch - $16.22 / Dinner - $16.22 / Snack - $6.44"
- Reads as a pricing-tier construct where the "tiered" rate is HIGHER than the base $11.35 — likely a contract typo or non-obvious tier logic.

### C-7. TXR - TX - H postseason per-game denominator absent

- Contract § 2.a p.2: "the Rangers shall pay Contractor a pro rata Services Fee for each 2026 Postseason Game" — does NOT specify per-game denominator.
- MONEY_MODEL: "$7,457.93 per game" = $604,032 / 81 = derivation, not contract text.
- Not a live conflict — mechanic is unambiguous — but the per-game figure is DERIVED not STATED. Flag for tighter contract language on renewal.

---

## D. Documentation corrections (to apply in a SEPARATE follow-up doc pass, NOT this PR)

### D-1. SC_MONEY_MODEL.md — Joe Fauzia → Joe Lessard

- **Source** (Kevin's provenance correction, 2026-07-14): "SC_MONEY_MODEL.md credits Price Review v3 to 'Joe Fauzia' — that name is an error; the person is Joe Lessard. Tag all Price Review provenance as Lessard. Log the MONEY_MODEL name fix in CONFLICT_REGISTER.md as a resolved doc-correction candidate (do NOT edit MONEY_MODEL in this pass)."
- **Current MONEY_MODEL text** (line 38): "Price Review v3 (Joe Fauzia + Kevin Fietek, week of 2026-06-16)"
- **Corrected text** (for follow-up doc PR): "Price Review v3 (Joe Lessard + Kevin Fietek, week of 2026-06-16)"
- **Status**: **RESOLVED — pending follow-up doc PR**. Not edited in this pricing-summit evidence pass per Kevin's ruling.

### D-2. TBR - FL invoice memo template — "2025" appears in 2026 invoices

- **Source** (Invoices K300168545 + K300168871, both 2026): memo text "This Invoice is for the 2025 Tampa Bay Rays MLB Meal Service" / "2025 Tampa Bay Rays MiLB Meal Service"
- **Fix**: Sebastian's QB template needs year-rollover for TBR-FL memos.
- Cosmetic — not a billing conflict; flag for Sebastian.

---

## E. Non-conflicts (intentionally NOT flagged — per Kevin's addendum ruling context)

- **Contracts stating "not inclusive of sales tax" / "plus applicable taxes"**: consistent with Kevin's ruling "SC carries pre-tax only (tax applied in QB at invoice)". NOT a conflict.
- **Weekly per-meal invoicing vs SC's bi-weekly fiscal period**: Kevin's export unit is per-period CSV v1; the SC per-period export aggregates 1-2 weekly QB invoices per level. NOT a conflict; operational alignment note.
- **Flat_fee postseason "pro-rata annual fee" mechanic** (CIN-OH, STL-MO, TXR-TX-H): Kevin's postseason ruling ("same rates on additional service days") is satisfied for flat-fee accounts by pro-rating the annual fee per game. NOT a conflict.
- **Per-meal postseason "same rates during Postseason Period"** (TBJ-FL): satisfied per Kevin's ruling. NOT a conflict.
- **Contract supporting-doc requirements without client sign-off gate** (CIN-AZ, CIN-KY, CIN-OH, STL-FL, STL-MO, TBJ-FL, TBR-FL, TXR-AZ, TXR-TX-H, TXR-TX-V): Kevin ruled "count-verification not required (but if a contract REQUIRES client count sign-off, flag it — Kevin believes none do)". Reviewed all 9 contracts on file: **none require client count sign-off**. Consistent with Kevin's expectation.
- **C-1 (CIN Coffee/Fountain tax treatment)**: contract § IV.B.4 ("No taxes will be assessed and/or collected in connection with the beverage service") + PG `is_tax_free=true` + invoice no-"T"-flag are all THREE CONSISTENT. Reading is "tax-exempt at service level" (invoice arithmetic doesn't support "fixed-gross tax back-out" — the CPI-escalated figures $511.05 / $283.92 are 2023 base × ~1.135 CPI factor, not base × (1 + tax rate)). NOT a live conflict; documented as informational.

---

## F. Chase-result summary

| # | Chase | Result |
|---|---|---|
| 1 | CIN - AZ 2026 SOW/amendment present in folder or still missing? | **MISSING** — see C-1 |
| 2 | TBJ - NY contract present or still absent? | **ABSENT** — see C-2 |
| 3 | TBR - FL: 2026 SF billing evidence either way? | **NONE FOUND** in invoice sample; contract silent — see A-2 |
| 4 | Coffee/Fountain contract tax clause verbatim | **CAPTURED verbatim** — see E "C-1" and EVIDENCE_CIN-AZ.md §2.7 |
| 5 | TBJ - FL lump-sum mechanics (prepayment/deposit/fee-equivalent?) | **NO lump-sum, prepayment, or deposit language** on the $452,812 SF; weekly per-meal invoicing per § 12(e) — see EVIDENCE_TBJ-FL.md §2.11 |
| 6 (addendum) | Postseason clauses per account | **Captured verbatim** where present (CIN-OH, STL-MO, TXR-TX-H). Consistent with Kevin's ruling. TBJ-FL postseason at same rates. Others silent. |
| 7 (addendum) | Billing cadence per invoice sample | **Captured per §8 in each evidence file**. Weekly (CIN-AZ bi-weekly per contract), quarterly (STL-FL), all Net 30. |
| 8 (addendum) | QuickBooks artifacts | **Captured per §9 in each evidence file**. K3 prefix scheme, `Item` field encodes account + service, "T" flag = taxable, memo convention identifies account+level+season. |

---

## G. Summary count (Phase 0a evidence pass, pre-P&L)

- **Live conflicts (A)**: 7
- **Rate-table gaps (B)**: 6
- **Paperwork gaps CONFIRMED (C)**: 7
- **Doc corrections (D)**: 2
- **Non-conflicts / consistent (E)**: 6 categories

Kevin rules all A + C + D at the summit; B is a mechanical MONEY_MODEL digest expansion; E is informational.

---

# Phase 0b — 2026 P&L per-site deep-dive additions (2026-07-14)

New conflicts surfaced from the P&L extract. Same A/B/C/D/E taxonomy. Cross-reference: `docs/pricing-summit/PL_2026_APPENDIX.md` and `docs/pricing-summit/BILLING_TERMS_MATRIX.md`. **Recognition-vs-billing differences are NOT flagged as conflicts per Kevin's Interpretation Guard** — only real disagreements make it into A-*.

## A. Live conflicts (Phase 0b additions, Kevin rules)

### A-8. P&L account-code classification: flat-fee SF booked in 2400.1, not 2300

- **Source A** (`docs/SC_MONEY_MODEL.md` §e p.28-29): "2400.1 Meal Service (Home) = per-meal invoice = actual_count × post-SF invoice rate. ... 2300 Service Charges = Service Fee attributable to the review period."
- **Source B** (P&L 2026 individual-site files):
  - **CIN - OH** (R25 verbatim): 2400.1 = $376,688/yr; R22 2300 = $0. Contract fee = $362,500 flat SF.
  - **STL - FL** (R25): 2400.1 = $1,400,000/yr; R22 2300 = $0. Contract fee = $1,400,000 flat SF.
  - **STL - MO** (R25): 2400.1 = $439,431/yr (meal-services portion of $473K); R22 2300 = $50,000 (Road Food only).
  - **TXR - TX - H** (R25): 2400.1 = $604,019/yr; R22 2300 = $0. Contract fee = $604,032 flat SF.
- **Delta**: 4 flat-fee accounts' SFs land in 2400.1 (Meal Service (Home)), not 2300 (Service Charges), on the P&L. MONEY_MODEL §e mapping treats 2400.1 as per-meal-only and 2300 as the SF line — the P&L convention differs.
- **Kevin rules**: whether MONEY_MODEL §e should be amended to reflect the P&L classification, or the P&L classification should be adjusted to match MONEY_MODEL §e, OR both are correct with a clear "P&L classification decouples from MONEY_MODEL SF taxonomy" note.

### A-9. STL - FL P1 amount + peak-period location: P&L contradicts GOTCHAS

- **Source A** (`docs/GOTCHAS.md` claim, cited via MONEY_MODEL §g p.234-235): "STL-FL prorated allocation: the $1.4M is spread PHASE-AWARE across the 13 periods per the P&L pattern (P1 $45,553 ... P3 peak $407,375 ... FCL plateau $98,915 ... offseason $0)."
- **Source B** (P&L R25 for STL-FL, `docs/pricing-summit/PL_2026_APPENDIX.md` §3.4):
  - P1 = **$171,367** (not $45,553 as GOTCHAS states)
  - P2 = **$407,375** (peak) — GOTCHAS placed the peak at P3
  - P3 = **$132,755**
  - P4-P8 = $98,915 each (5 periods; confirms "FCL plateau" claim)
  - P12-P13 = $0 (confirms offseason)
- **Delta**: GOTCHAS' P1 number is 3.76× too low; peak period is P2 not P3.
- **Kevin rules**: `docs/GOTCHAS.md` (lines around the STL-FL allocation) should be updated to the P&L-verified values. Not a MONEY_MODEL conflict per se; a stale downstream doc.

### A-10. CIN - AZ 2200 Catering Revenue not documented in MONEY_MODEL

- **Source A** (`docs/SC_MONEY_MODEL.md` per-account digest, CIN - AZ row): no 2200 Catering Revenue line item.
- **Source B** (P&L R21 for CIN-AZ, `docs/pricing-summit/PL_2026_APPENDIX.md` §3.2): 2200 = $52,000/yr (row shows P1 $3,000 + P2 $3,000, then zeros with Year total $52,000 — sum-of-periods delta of $46K suggests a hidden P13 value or Year-column formula).
- **Delta**: $52K annual "Catering Revenue" line for CIN-AZ appears on the P&L; MONEY_MODEL is silent. Also the intra-file arithmetic ($6K periods sum vs $52K Year) needs verification with the accountant.
- **Kevin rules**: whether 2200 is a legitimate CIN-AZ revenue line (educational-services cooking classes at $1,000/class per contract § IV.C p.7? outside-catering at CIN-AZ Goodyear? something else?) and whether MONEY_MODEL should document it.

### A-11. TBR - FL 2200 Catering Revenue not documented in MONEY_MODEL

- **Source A**: MONEY_MODEL per-account digest, TBR - FL row: no 2200 Catering Revenue.
- **Source B** (P&L R21 for TBR-FL, PL_2026_APPENDIX §3.8): 2200 = **$79,950/yr** spread across P1-P12 with varying weekly amounts.
- **Delta**: MONEY_MODEL silent on ~$80K/yr TBR-FL catering revenue. Likely B&G Boys & Girls Club $6.50/lunch (per MONEY_MODEL §Open items #6) + Road Sandwiches + other ancillary catering per invoice K300168871. Needs classification.
- **Kevin rules**: whether 2200 for TBR-FL should be documented in MONEY_MODEL (and whether B&G is the primary contributor).

### A-12. P&L 2300 for TBR - FL supports fresh 2026 SF billing (C-2 evidence)

- **Source A** (Minor League SOW § 6(c) p.6): $382,448 = TWO 2024 installments ($200K + $182,448 by Feb 1, 2024). Contract SILENT on 2025+ recurrence.
- **Source B** (P&L R22 for TBR-FL): **2300 = $457,768/yr** for 2026, spread P1-P11 in a season-weighted pattern (peak P2 $99,287; plateau P3-P8 ~$41K; decline P9-P11).
- **Source C** (Invoice K300168545 + K300168871): NO 2300 SF line on the 2026 TBR-FL invoices in the sample (both pure per-meal).
- **Delta**: P&L books $457,768/yr; contract expired one-time 2024 payment; invoice sample doesn't show SF billing. Three possibilities:
  1. A NEW 2026 SF has been billed but not sampled (SF invoice likely on a separate cadence than per-meal, not in the two weekly per-meal invoices we saw).
  2. The P&L reflects revenue-recognition of amortized $382,448 with delta being CPI-escalation + accounting rounding. 19.7% delta is large for pure CPI.
  3. The $457K represents a projected 2026 SF that Kevin is budgeting for but hasn't executed via written contract.
- **Kevin rules**: C-2 is HELD. This entry documents the evidence, does not conclude.

### A-13. TXR - TX - V P&L books $312,000/yr in 2400.1 despite MONEY_MODEL "$0 covered by H"

- **Source A** (`docs/SC_MONEY_MODEL.md` §g + fee schedule table): TXR-TX-V is $0 fee-schedule, "covered by TXR-TX-H contract"; "Real visiting-team direct-sales revenue is tracked in the Season Tracker workflow (sold-through revenue × 19.23% labor model), out of scope for the SC and the fee schedule."
- **Source B** (P&L R25 for TXR-TX-V, PL_2026_APPENDIX §3.11): **2400.1 = $312,000/yr**, spread P3-P9 season pattern ($312K / 81 games ≈ $3,852/game).
- **Delta**: TXR-TX-V has $312K/yr on the P&L (presumably the Season Tracker direct sales). MONEY_MODEL treats this as out-of-scope for the SC + fee schedule; the P&L includes it in 2400.1.
- **Kevin rules**: whether TXR-TX-V's direct-sales revenue should flow through the SC (currently no), or MONEY_MODEL should be updated to acknowledge the P&L classification, or both.

## B. Rate-table gaps (Phase 0b additions)

### B-7. CIN - AZ 2200 Catering Revenue line item

- New line item: 2200 Catering Revenue $52,000/yr. Add to MONEY_MODEL per-account digest if Kevin approves A-10.

### B-8. TBR - FL 2200 Catering Revenue line item

- New line item: 2200 Catering Revenue $79,950/yr. Same treatment.

### B-9. STL - MO Road Food Management as separate 2300 line

- Verbatim from P&L: line reads "**2300 Service Charges - Road Catering**" ($50,000/yr). MONEY_MODEL §Fee schedule table lists "$50,000 for 'Road Food Management' services". Both consistent; the P&L uses "Road Catering" as the sub-label, MONEY_MODEL uses "Road Food Management". Minor labeling delta — no conflict, but flag for terminology alignment.

## C. Paperwork gaps (no Phase 0b additions)

None. All confirmed gaps were in Phase 0a.

## D. Documentation corrections (Phase 0b additions)

### D-3. GOTCHAS STL - FL P1 number

- Update `docs/GOTCHAS.md` (STL-FL prorated allocation entry) to: **P1 $171,367 · P2 peak $407,375 · P3 $132,755 · FCL plateau P4-P8 $98,915 · offseason P12-13 $0** (from P&L R25). Not applied here per Kevin's ruling; queue for a follow-up doc PR.

## E. Non-conflicts / consistent (Phase 0b — Kevin's interpretation guard applied)

- **P&L recognition spread ≠ contract billing schedule** for every account (CIN-AZ SF billed 75% Feb 1/25% Mar 15 but recognized across P1-P11; STL-FL SF billed quarterly but recognized across P1-P11; TXR-TX-H SF billed monthly Apr-Sep but recognized across P3-P9; etc.): **EXPECTED under Kevin's guard**. Recognition ≠ billing.
- **CIN-AZ 2300 P&L $445,716 vs contract 2023 base $402,016**: ~11% escalation over 3 years = consistent with § IV.B.3's CPI-U Food Away from Home 2%-5% band. EXPECTED.
- **TBJ-FL 2300 P&L $515,712 vs contract 2023 base $452,812**: ~14% escalation over 3 years = consistent with § 12(c) provider-initiated CPI approvals. EXPECTED.
- **STL-MO Total Revenue $489,431 vs contract base $473K**: CPI-escalated per § 2.d.i. EXPECTED.
- **TXR-AZ 2300 P&L $301,621 vs 2025 deposit $297,419**: ~1.4% higher. Consistent trajectory (may be a partial 2.5%/yr escalator or rounding to 2026 projection). EXPECTED.
- **CIN-OH 2400.1 $376,688 vs contract $362,500 base**: 3.9% escalation via § 2.a CPI-U Aug 1-4% band. EXPECTED.
- **All P&L rows show pre-tax figures (no tax line)**: consistent with Kevin's R9 ruling. EXPECTED.
- **All P&L rows exclude passthrough** (CIN-OH food/supplies, STL-MO $225K, STL-FL $900K): consistent with MONEY_MODEL §h. EXPECTED.
- **2400.1 sanity spot-check (CIN-AZ + TBJ-FL)**: rough `projected_count × post-SF rate` reconciliation lands within a few percent of the P&L number. EXPECTED (no arithmetic conflict).

---

## H. Phase 0b summary count

- **Live conflicts (A-8 through A-13)**: 6 new (grand total A-* = 13)
- **Rate-table gaps (B-7 through B-9)**: 3 new (grand total B-* = 9)
- **Paperwork gaps**: 0 new (grand total C-* = 7)
- **Doc corrections (D-3)**: 1 new (grand total D-* = 3)
- **Non-conflicts (per Kevin's interpretation guard)**: 8 new categories

Kevin rules all new A + D at the summit.

