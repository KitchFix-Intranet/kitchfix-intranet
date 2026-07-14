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

## G. Summary count

- **Live conflicts (A)**: 7
- **Rate-table gaps (B)**: 6
- **Paperwork gaps CONFIRMED (C)**: 7
- **Doc corrections (D)**: 2
- **Non-conflicts / consistent (E)**: 6 categories

Kevin rules all A + C + D at the summit; B is a mechanical MONEY_MODEL digest expansion; E is informational.
