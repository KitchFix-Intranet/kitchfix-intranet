# EVIDENCE — CIN - AZ

> **Purpose**: read-only evidence pack for the pricing summit. Verbatim contract quotes + verbatim invoice numbers + PG data + cross-checks against `docs/SC_MONEY_MODEL.md`. Every claim carries provenance; UNKNOWN where sources are silent. Flag-don't-resolve — Kevin rules at the summit.
>
> **Account**: CIN - AZ (Cincinnati Reds — Goodyear AZ PDC / Spring Training).
> **Shape**: SF% (30%) hybrid — annual Service Fee + per-meal Catering Fees.
> **Level**: PDC (per MONEY_MODEL account taxonomy; billing_model `actuals_drive_invoice`).

---

## §1. Sources

- **Contract**: `/Users/kevinfietek/Documents/Claude /Contracts/CIN AZ/Reds & Kitchfix Signed Agreement-2023 copy.pdf` — "Catering Services Agreement", effective January 3, 2023, Initial Term through 12/31/2025 with two 12-month renewal options through 2027.
- **Invoices in sample**: K300168587 (2026-03-22 MLB @ Goodyear, week of 3/9-3/22 partial); K300168736 (2026-05-17 MiLB @ Goodyear, week of 5/4-5/16 partial).
- **MONEY_MODEL digest row**: `CIN - AZ | SF% 30% | $18.42 / $29.01 sticker | **$12.90 / $20.31 post-SF** | $402,016/yr | Yes, invoice-rate meal revenue`.
- **Price Review v3 provenance**: Joe LESSARD (see CONFLICT_REGISTER §D-1 for MONEY_MODEL's incorrect "Joe Fauzia" attribution).
- **PG (see appendix)**: sc_service_prices `price_kind='projected'` for CIN-AZ carries the post-SF rates.

---

## §2. Contract evidence (verbatim)

### 2.1 Service Fee structure (§ IV.A p.6; § Exhibit B p.14)

> "The Club will pay to Kitchfix the 'Service Fee' calculated and described in Exhibit B."

> "The Service Fee is calculated as follows: · Kitchfix and Club are estimating a budget, based on the projected number of total meals and inclusive of sales tax assuming a 10.3% rate for Arizona, of $1,478,082 for the year. · This budget results in $1,340,056 of costs, before taxes · The Service Fee is calculated as 30% of the pre-tax budget estimate and equal to $402,016. · The pricing reflected in section IV is set to combine with the Service Fee to reach these budget figures"

### 2.2 SF payment cadence (§ IV.A.1 p.6; § IV.A.2 p.6)

> "The Service Fee will be payable as follows: a) 75% of the Service Fee is due and payable on February 1st each year of the Term; and b) The remaining 25% of the Service Fee is due and payable on March 15th each year of the Term."

> "Kitchfix shall provide the Club with an invoice for the Service Fee no later than January 15th each year of the Term."

### 2.3 Escalation clause (§ IV.B.3 p.6)

> "Beginning with calendar year 2024 and each year of the Term thereafter, the per meal cost will be determined by the Consumer Price Index for All Urban Consumers (CPI-U): U.S. City Average, Food Away from Home annual increase as of October. Annual rate increases shall have a floor of 2% and a cap of 5%."

### 2.4 Annual approval / re-scoping (§ I.F p.3)

> "Each year during the Term, the Club and Kitchfix agree to mutually review the annual schedule, meal and snack timing, and the SOP on or before December 15th to confirm meal counts and establish the service fee for the subsequent season."

### 2.5 Per-meal rates — 2023 base (§ IV.B.1 p.6; § IV.B.2 p.6)

MLB (Spring Training only):
> "Major League Catering Services Pricing (during Major League Spring Training only) a) Breakfast - $17.88 per person b) Lunch - $17.88 per person c) Dinner - $17.88 per person"

MiLB:
> "Minor League Catering Services Pricing a) Breakfast - $11.35 per person b) Lunch - $11.35 per person c) Dinner - $11.35 per person d) Snack - $4.51 per person e) Club will have the option to add a Late Night meal that will be priced: i) $12.77 per person if the Club only serves two (2) hot meals in a day which are more than eight (8) hours apart; or ii) at the same cost as the Dinner per person rate in all other cases."

### 2.6 MiLB volume threshold (Exhibit B p.14)

> "Meals will be billed at the following rates once a total of 72,890 meals have been billed in 2023: o Minor League Catering Services Pricing § Breakfast - $16.22 per person § Lunch - $16.22 per person § Dinner - $16.22 per person § Snack - $6.44 per person"

**Note**: as recorded verbatim, the "drop" rates are HIGHER than the base $11.35 / $4.51. Likely a typo or pricing-tier construct. See CONFLICT_REGISTER §C-1a.

### 2.7 Coffee Service + Fountain Beverages (§ IV.B.4 pp.6-7)

**C-1 evidence — verbatim tax language on beverages:**

> "Each year of the Term, the Club will have the option to add coffee service at the rate of $450/week and fountain beverages at the rate of $250/week. No taxes will be assessed and/or collected in connection with the beverage service. If the Club exercises either options for beverage services, Kitchfix agrees that the fee shall be calculated based on a maximum of 45 weeks of beverage service in the applicable calendar year."

### 2.8 Catering-services tax (§ IV.D p.7)

> "Kitchfix will separately state the tax applicable to the Catering Services and the Club agrees to pay such tax."

### 2.9 Kitchfix general tax obligation (§ II.A.1 p.3)

> "Kitchfix shall be solely liable for and shall pay at its sole expense all taxes lawfully assessed in connection with or arising out of this Agreement."

### 2.10 Invoice cadence + Net terms (§ V.A-D p.7)

> "Each week, the Club will provide Kitchfix a preliminary weekly meal count for the immediately succeeding week. The Club will provide Kitchfix a final meal count at least one day prior to the Monday of the upcoming week. Kitchifix will provide the Club the actual meal count on the day following the day on which Kitchfix provided the Catering Service."

> "Kitchfix will submit invoices for the Catering Fees in arrears for compensation for the Catering Services every fifteen (15) days and in detail sufficient for a proper pre- and post-audit."

> "The invoiced amount for the Catering Fees shall be due and payable thirty (30) days from the date of the Club's receipt such invoice. Kitchfix will invoice for the final meal counts provided to them, so long as the actual meal counts have not gone over the projected meal counts. In the scenario where meal counts are over the projected amount, Kitchfix will charge for the additional meals."

**"Overage at actuals price"** — CONFIRMED verbatim.

### 2.11 Passthrough — NONE at CIN-AZ

Contract explicitly assigns all food/beverage/supplies/equipment to KitchFix:

> "Kitchfix shall furnish all food, beverages, equipment, small wares, supplies and service wear ... and any other supplies necessary to operate the dining facilities" (§ III.B.12 p.5)

> "Kitchfix shall provide all janitorial and supplies required for the safe and sanitary operation ..." (§ III.B.11 p.5)

Club-provided kitchen: "at no charge" § III.B.1 p.5.

### 2.12 Force Majeure fee adjustment (§ IV.F p.7)

> "All fees are subject to the Force Majeure provisions set forth in Section VII and the Service Fee, exclusive of the initial installment of the Service (equal to 75% of the Service Fee). Except for the initial installment of the Service Fee, all fees payable hereunder by Club be proportionally reduced and returned to the Club based on the number of days that Catering Service were not provided due to a Force Majeure Event, divided by the total estimate of 240 service days."

### 2.13 Invoice-delivery / cost-center

> "Kitchfix will submit invoices for payment electronically to Ashley Meuser at ameuser@reds.com with a copy to sgrossman@reds.com." (§ V.D p.7)

### 2.14 SF true-up / immutability

Contract fixes SF at $402,016 via Exhibit B. **UNKNOWN** whether the SF is subject to year-end reconciliation against the actual $1,340,056 pre-tax cost basis — contract silent.

### 2.15 MLB-separate-invoices-during-ST

**UNKNOWN** — contract distinguishes MLB Spring Training pricing from MiLB pricing but does not require separate invoices. Only single invoice-mechanics clause exists (§ V.B / V.D).

### 2.16 Postseason rates

**UNKNOWN** — no postseason clause.

---

## §3. Invoice evidence (verbatim)

### 3.1 Invoice K300168587 — 2026-03-22 CIN-AZ MLB (Goodyear)

- **Bill To**: Sarah Vedder / Cincinnati Reds
- **Note**: "This invoice is for the Cincinnati Reds @ Goodyear, AZ - 2026 MLB Meal Service"
- **Terms**: Net 30 (due 04/21/2026)
- **Total**: $63,285.45 (Subtotal $57,375.75 + Tax $5,909.70)
- **Every line**: "REDS MLB - Meal Service", unit rate **$20.31**, T-flagged (taxable)
- **Tax rate implied**: $5,909.70 / $57,375.75 = **10.3%** (Goodyear AZ)
- **14 daily rows**, dates 03/09/2026 - 03/22/2026, qty ranges 180-270/day, all @$20.31

**Rate match**: $20.31 = MONEY_MODEL CIN-AZ MLB post-SF **EXACT MATCH**.

### 3.2 Invoice K300168736 — 2026-05-17 CIN-AZ MiLB (Goodyear)

- **Bill To**: Sarah Vedder / Cincinnati Reds
- **Note**: "This invoice is for the Cincinnati Reds @ Goodyear, AZ - 2026 MiLB Meal Service"
- **Terms**: Net 30 (due 06/16/2026)
- **Total**: $29,861.15 (Subtotal $27,221.14 + Tax $2,640.01)
- **12 daily meal-service rows** @ **$12.90** per meal, qty 154/day, T-flagged
- **7 daily snack rows** @ **$5.12** per snack, qty 50, T-flagged
- **2 Coffee Service rows** @ **$511.05**, qty 1, **NOT T-flagged**
- **2 Fountain Beverages rows** @ **$283.92**, qty 1, **NOT T-flagged**
- **Effective taxable tax rate**: $2,640.01 / ($27,221.14 − $1,589.94) = $2,640.01 / $25,631.20 = **10.3%** (Goodyear AZ)

**Rate matches**:
- $12.90 = MONEY_MODEL CIN-AZ MiLB post-SF **EXACT MATCH**.
- $5.12 snack — not in digest. Contract 2023 base $4.51 → escalated. Contract clause supports snack pricing (§ IV.B.2.d, $4.51 base).
- $511.05 coffee — not in digest table but MATCHES `ACCOUNT_SERVICES_BRIEF.md:66` ("$511.05/wk; 2023 base was $450/wk with 45 wk/yr cap"). Ratio $511.05/$450 = 1.135.
- $283.92 fountain — matches `ACCOUNT_SERVICES_BRIEF.md:67`. Ratio $283.92/$250 = 1.1357.

### 3.3 Invoice sample grouping (CIN-AZ)

- **MLB and MiLB are on SEPARATE invoices for the same account, same billing month.**
- Weekly (Sat-Sun cadence based on activity in K300168587 and K300168736).
- Cost-center / PO fields: UNKNOWN (no line for these on the invoices).

---

## §4. PG evidence

Excerpt from `/tmp/pricing-summit-pg-dump.md` (full appendix in the PR):

| account_key | service | is_flat_fee | is_tax_free | price_kind | price |
|---|---|---|---|---|---|
| CIN - AZ | MLB Breakfast | | | projected | 20.31 |
| CIN - AZ | MLB Lunch | | | projected | 20.31 |
| CIN - AZ | MLB Dinner | | | projected | 20.31 |
| CIN - AZ | MiLB Breakfast | | | projected | 12.90 |
| CIN - AZ | MiLB Lunch | | | projected | 12.90 |
| CIN - AZ | MiLB Dinner | | | projected | 12.90 |
| CIN - AZ | MiLB Snack | | | projected | 5.12 |
| CIN - AZ | Coffee Service | ✓ | ✓ | projected | 511.05 |
| CIN - AZ | Fountain Bev | ✓ | ✓ | projected | 283.92 |

`sc_fee_schedule`: **no row for CIN-AZ**. Consistent with MONEY_MODEL — CIN-AZ SF is a service-fee (contract-revenue layer) not a flat_fee (fee schedule row).

`accounts`: `billing_model = actuals_drive_invoice`, `has_homestand_schedule = false`, `has_schedule_overlay = false`, `level = PDC`.

---

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Invoice | PG | Verdict |
|---|---|---|---|---|
| Sticker $29.01 MLB / $18.42 MiLB | UNKNOWN (contract 2023 base $17.88 / $11.35 + CPI Oct 2-5% band) | UNKNOWN (invoices show post-SF only) | not stored | Consistent trajectory; source of the specific $29.01/$18.42 = Price Review v3 (Lessard), NOT in the 2023 contract paperwork. See CONFLICT_REGISTER §Q4. |
| Post-SF $20.31 MLB / $12.90 MiLB | Post-SF = sticker × 0.70 per SF% mechanic | **$20.31 + $12.90 exact match** | **exact match** | ✓ agreed |
| $402,016/yr SF | **$402,016** verbatim (§ Exhibit B) | not in per-meal invoice sample | not stored (SF layer not in `sc_fee_schedule`) | ✓ agreed on 2023 base; whether 2026 SF has escalated is UNKNOWN in the paperwork. |

---

## §6. UNKNOWN / gaps

- **2026 SOW or contract amendment**: NOT PRESENT in `/Users/kevinfietek/Documents/Claude /Contracts/CIN AZ/`. The only paperwork is the 2023 base contract. Confirms MONEY_MODEL Q4 open gap.
- **2026 SF amount** (after CPI escalation from $402,016 base): UNKNOWN in paperwork.
- **Postseason rates**: UNKNOWN (no clause).
- **MLB-vs-MiLB separate invoicing during ST**: not required by contract, but invoice sample confirms operational practice of separate invoices.
- **SF true-up / reconciliation clause**: UNKNOWN — contract silent.

---

## §8. Postseason (verbatim)

**UNKNOWN** — the CIN-AZ contract has no postseason clause. Spring Training account; postseason mechanic not relevant to CIN-AZ (postseason is at CIN-OH). Kevin's ruling ("postseason = same rates + additional days") not tested against a written postseason clause here. No flag.

## §9. Billing cadence (invoice-sample evidence)

- **Contract cadence** (§ V.B p.7): "invoices for the Catering Fees ... every fifteen (15) days"
- **Invoice K300168587 (MLB)**: period 03/09/2026 – 03/22/2026 = 14 days. **Bi-weekly.** Consistent with contract.
- **Invoice K300168736 (MiLB)**: period 05/04/2026 – 05/16/2026 = 13 days (multi-week block; some intra-week gaps). **Bi-weekly (approx).** Consistent.

**Note vs Kevin's export-unit-is-period ruling**: SC's fiscal period is ~15 days (bi-weekly), which aligns cleanly with CIN-AZ contracted invoice cadence. One SC period → one CIN-AZ invoice. Good fit.

## §10. QuickBooks artifacts (from invoice sample)

- Invoice number scheme: `K300168587`, `K300168736` — 9-digit numeric with `K3` prefix. Sebastian-generated in QuickBooks.
- Line-item "Item" field appears to encode account + service, e.g. `REDS MLB - Meal Service`, `REDS MiLB - Meal Service`, `REDS Coffee Service`, `REDS Fountain Beverages`, `REDS MiLB/MLB - Snack`.
- "T" suffix on the extended-amount column = QuickBooks taxable flag. Coffee + Fountain lines omit "T" (non-taxable). Meal + Snack lines carry "T".
- Description column carries per-day meal-count breakdown text: `"Breakfast - 110 & Lunch - 110. Total = 220."`
- Memo line at header: `"This invoice is for the Cincinnati Reds @ Goodyear, AZ - 2026 MLB Meal Service"` — Sebastian's memo convention identifies account + level + season.
- No Class / Location field visible on the invoice PDFs (QB Class-tracking may not be enabled or is invisible in the client-facing view).

## §11. Count-verification (client sign-off clause)

Contract § V.A p.7:
> "Kitchifix will provide the Club the actual meal count on the day following the day on which Kitchfix provided the Catering Service."

This is a KitchFix-to-Club REPORTING clause, not a Club-must-sign-off gate. **Contract does NOT require client count sign-off before invoicing.** Consistent with Kevin's expectation.

## §12. Local flags (also in CONFLICT_REGISTER)

- **C-1** (Coffee/Fountain tax treatment): contract § IV.B.4 says "No taxes will be assessed and/or collected in connection with the beverage service". Invoice practice: no "T" flag on those lines, no tax added. `is_tax_free = true` in PG. All three consistent. Reading is closer to **exemption at service level** than "fixed-gross (tax back-out)" — the invoice arithmetic doesn't support tax back-out (invoice numbers $511.05 / $283.92 = 2023 base × ~1.135 CPI-escalation-factor, not base × (1+rate) tax-inclusive). Documented as informational; no live conflict.
- **§C-1a** (Exhibit B typo): $16.22 tier is HIGHER than $11.35 base — reads as pricing-tier construct or typo. Contract silent on intent.
- **§Q4** (CIN-AZ 2026 SOW missing): confirmed absent in folder. Same status as MONEY_MODEL noted 2026-07-09.
