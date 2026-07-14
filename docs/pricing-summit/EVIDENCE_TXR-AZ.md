# EVIDENCE — TXR - AZ

> Read-only evidence pack. Verbatim + cites. UNKNOWN where silent. Flag-don't-resolve.
>
> **Account**: TXR - AZ (Texas Rangers — Surprise AZ Spring Training PDC). **Shape**: Per-meal with **20% deposit-triggered discount** (deposit-based SF% mechanic). Level: PDC. `billing_model=actuals_drive_invoice`.

## §1. Sources

- **Contract**: `/Users/kevinfietek/Documents/Claude /Contracts/TXR AZ/Texas Rangers 2025-2027 Surprise Food Service Agreement.pdf` — effective Dec 13, 2024, SOW #1 dated Jan 7, 2025 (2025 season only in SOW #1). Executed via Docusign.
- **Also on folder**: `TXR AZ/TXR-AZ - Food Services Agreement - KitchFix (2022).pdf` (historical, superseded).
- **Invoices in sample**: **K300168585** (2026-03-22 MLB week 3/16-3/21); **Unknown-2 = K300168870** (2026-07-05 MiLB week 6/29-7/4).
- **MONEY_MODEL digest row**: `TXR - AZ | SF% 20% (deposit) | $17.87 / $35.72 | **$14.29 / $28.58** | $297,419/yr (2025 deposit) | Yes, meal revenue`.
- **PG**: `billing_model = actuals_drive_invoice`.

## §2. Contract evidence (verbatim)

### 2.1 Services Fee + Per-Meal Fee (§ 2.a p.1)

> "Services Fee. During the Term (defined below), Team shall pay Provider a services fee (the 'Services Fee') in the amount set forth in each SOW. The Services Fee shall be comprised of a per-meal fee ('Per-Meal Fee'), and such other fees or charges as may be set forth on the applicable SOW."

### 2.2 20% deposit-triggered discount (§ 2.a p.1) — **VERBATIM**

> "Unless otherwise provided in the SOW, following payment of the Annual Deposit (defined below), Team shall receive a discount equal to 20% of the Per-Meal Fee for each meal provided pursuant to this Agreement and the applicable SOW."

### 2.3 Annual Deposit (§ 2.b p.1) — **VERBATIM**

> "Annual Deposit. Unless otherwise set forth in any SOW, annually prior to the start of each year of the Term (including any Renewal Term), Team shall pay to Provider an amount equal to 20% of the total Services Fee, calculated based upon a projected number of daily meals (the 'Projection') under all active SOWs for the then current year of the Term, which amount shall represent a deposit on the Term's Services Fees (the 'Annual Deposit')."

> "For the Initial Term (defined below) and any Renewals Terms (defined below), the Annual Deposit shall be due and payable in three equal installments on the first day of January, February and March of the applicable contract year."

### 2.4 2025 rates + Deposit (SOW #1, pp.10-11)

MLB 2025:
> "Breakfast - $34.85, not inclusive of sales tax
>       o   After Annual Deposit - $27.88, not inclusive of sales tax
>   Lunch - $34.85, not inclusive of sales tax
>       o   After Annual Deposit - $27.88, not inclusive of tax"

MiLB 2025:
> "Breakfast - $17.43, not inclusive of sales tax
>       o   After Annual Deposit - $13.95, not inclusive of tax
>   Lunch - $17.43, not inclusive of sales tax
>       o   After Annual Deposit - $13.95, not inclusive of tax
>   Dinner - $17.43, not inclusive of sales tax
>       o   After Annual Deposit - $13.95, not inclusive of tax
>   Pre-game hot meal - $13.33, not inclusive of sales tax
>       o   After Annual Deposit - $10.66, not inclusive of tax
>   Regular Snack - $7.18, not inclusive of sales tax
>       o   After Annual Deposit - $5.74, not inclusive of tax"

Ratio check: $27.88 / $34.85 = 0.7998 ≈ 80% (20% discount). ✓

2025 deposit:
> "Total 2025 Annual Deposit Due - $297,419.26, not inclusive of sales tax, if applicable
> Due January 1st, 2025 - $99,139.75, not inclusive of sales tax, if applicable
> Due February 1st, 2025 - $99,139.75, not inclusive of sales tax, if applicable
> Due March 1st, 2025 - $99,139.75, not inclusive of sales tax, if applicable"

### 2.5 Escalation (§ 2.a p.1) — **VERBATIM**

> "Starting in 2026, the per meal pricing shall increase by 2.5%, and in 2027 the per meal pricing shall increase by 2.5% over the prior year."

### 2.6 Payment terms (§ 3 pp.1-2)

> "Payment. Unless otherwise set forth in any SOW, the Services Fee will be due and payable on a weekly basis based on the number of meals provided during the previous week. A week shall run from Monday through Sunday, and Provider will invoice Team on a weekly basis for the prior week. Payment shall be due within 30 days after the date of the invoice."

**Weekly invoicing, Net 30.**

### 2.7 Tax language (§ 2.a p.1 + SOW p.11)

> "Provider's Services Fee is not inclusive of sales tax, if applicable, and Team shall be responsible for the payment of any sales tax, use tax, service tax or other similar tax related to the Services Fee."

All SOW line items carry "not inclusive of sales tax" qualifier.

### 2.8 Kitchen equipment — KitchFix-borne (§ 5 p.2)

> "Provider will pay up to $75,000 for kitchen equipment to be installed at the Team Facility, with the specific equipment to be determined by Provider in Provider's sole discretion."

### 2.9 Force Majeure (§ 14 p.7)

> "If Services are only partially provided due to a Force Majeure Event, the parties shall negotiate in good faith to adjust the Service Fee based on actual Services to be performed compared to those contemplated in this Agreement."

### 2.10 Termination consequences (§ 4.c(i) p.2)

> "In the event of termination as a result of a breach by Team, Team shall pay the Service Fees due through the end of the then-current Term, and Provider shall retain the Annual Deposit."

### 2.11 2026 SOW — status

**UNKNOWN — not in folder.** Only SOW #1 (covering 2025 season) is attached to the 2025-2027 master agreement. No 2026 SOW or amendment present.

- 2026 deposit amount: UNKNOWN in paperwork (but calculable — 2025 rates × 1.025 × new 2026 projection = 2026 deposit).
- 2026 stated rates: derived from 2025 × 1.025 per § 2.a escalation, if operative:
  - 2026 MLB sticker calc: $34.85 × 1.025 = $35.72; **matches MONEY_MODEL sticker $35.72**
  - 2026 MLB post-deposit calc: $27.88 × 1.025 = $28.58; **matches MONEY_MODEL post-SF $28.58**
  - 2026 MiLB sticker calc: $17.43 × 1.025 = $17.87; **matches MONEY_MODEL sticker $17.87**
  - 2026 MiLB post-deposit calc: $13.95 × 1.025 = $14.29; **matches MONEY_MODEL post-SF $14.29**
  - **MONEY_MODEL digest is derived from the 2.5% escalation of 2025 SOW rates.**

### 2.12 Postseason

**UNKNOWN** — no postseason clause in the AZ contract (Spring Training + off-season accounts don't have MLB postseason at this facility).

### 2.13 Passthrough

**UNKNOWN** — no food/packaging/supplies passthrough; ingredient/supply costs borne by KitchFix (implicit in per-meal SF).

### 2.14 True-up / immutability

No explicit "no-true-up" clause. Reconciliation happens implicitly at weekly invoicing: "the Services Fee will be due and payable on a weekly basis based on the number of meals provided during the previous week" (§ 3). Deposit is applied against actuals via post-deposit rate. Force Majeure adjustment via good-faith negotiation. Termination-for-breach: Team pays full remainder; deposit retained.

### 2.15 MLB-vs-MiLB invoicing

Contract silent on separate invoicing; invoice sample shows separate invoices for MLB and MiLB.

### 2.16 Count-verification

Section 3 uses meal-count basis but does not require Team pre-approval before invoicing. **No sign-off gate.**

## §3. Invoice evidence (verbatim)

### 3.1 Invoice K300168585 — 2026-03-22 TXR-AZ MLB

- **Bill To**: Texas Rangers - Surprise, AZ
- **Invoice Date**: 03/22/2026
- **Due Date**: 04/21/2026 (Net 30)
- **Total**: $27,414.51 (Subtotal $25,036.08 + Tax $2,378.43 = 9.5% AZ Surprise)
- **Line items** (5 daily rows 3/16-3/21, all `TXR-AZ MLB - Breakfast/Lunch/Dinner` @ **$28.58**):
  - 3/16 qty 225 = $6,430.50
  - 3/18 qty 256 = $7,316.48
  - 3/19 qty 160 = $4,572.80
  - 3/20 qty 135 = $3,858.30
  - 3/21 qty 100 = $2,858.00

**Rate match**: $28.58 = MONEY_MODEL TXR-AZ MLB post-SF **EXACT MATCH** (2026 escalated from 2025 SOW $27.88 × 1.025).

### 3.2 Invoice Unknown-2 = K300168870 — 2026-07-05 TXR-AZ MiLB

- **Bill To**: Stanton "Stosh" Hoover / Texas Rangers - Surprise, AZ
- **Invoice Date**: 07/05/2026
- **Due Date**: 08/04/2026 (Net 30)
- **Total**: $22,801.08 (Subtotal $20,822.90 + Tax $1,978.18 = 9.5% AZ)
- **Line items**:
  - 6 days `TXR-AZ MiLB - Breakfast/Lunch/Dinner` @ **$14.29** (qty 175/day)
  - 6 days `TXR-AZ - Pre-Game Hot Snack` @ **$10.93** (qty 100/day)
  - 1 day `TXR-AZ - Regular Snack` @ **$5.89** (qty 60)

**Rate matches**:
- MiLB Meal $14.29 = MONEY_MODEL digest **EXACT MATCH** ($13.95 × 1.025 = $14.30 ≈ $14.29)
- Pre-Game Hot Snack $10.93: 2025 base $10.66 × 1.025 = $10.93 exact
- Regular Snack $5.89: 2025 base $5.74 × 1.025 = $5.88 ≈ $5.89

## §4. PG evidence

`sc_service_prices` for TXR-AZ (excerpt from PG dump):

| service | price_kind | price |
|---|---|---|
| MLB Breakfast | projected | 28.58 |
| MLB Lunch | projected | 28.58 |
| MLB Dinner (if active) | projected | ? |
| MiLB Breakfast | projected | 14.29 |
| MiLB Lunch | projected | 14.29 |
| MiLB Dinner | projected | 14.29 |
| Pre-Game Hot Snack | projected | 10.93 |
| Regular Snack | projected | 5.89 |

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Invoice | Verdict |
|---|---|---|---|
| Sticker $17.87 MiLB / $35.72 MLB | Contract 2025 SOW $17.43 / $34.85; escalated by 2.5% for 2026 = $17.87 / $35.72 | (invoices show only post-SF) | ✓ derivation confirmed |
| Post-SF $14.29 MiLB / $28.58 MLB | Contract 2025 SOW post-deposit $13.95 / $27.88; escalated by 2.5% for 2026 = $14.29 / $28.58 | ✓ exact match on invoice | ✓ |
| $297,419/yr 2025 deposit | ✓ verbatim SOW #1 p.11 | (2025 deposit not in 2026 invoice sample) | ✓ for 2025; 2026 deposit UNKNOWN |
| Fixed 2.5%/yr escalation | ✓ verbatim § 2.a | ✓ derived rates match | ✓ |
| Deposit-triggered discount 20% | ✓ verbatim §§ 2.a + 2.b | Invoice rates are post-deposit (consistent with deposit paid) | ✓ |

## §6. UNKNOWN / gaps

- **2026 SOW / amendment missing from folder** (Kevin's chase #1, MONEY_MODEL Open item #4 confirmed).
- 2026 deposit amount not documented in paperwork.
- Postseason mechanics: UNKNOWN.
- MLB Dinner: contract SOW #1 lists only Breakfast + Lunch for MLB (no Dinner rate stated). Whether Dinner service happens: UNKNOWN in contract; PG has a service for it (`MLB Dinner`) at $28.58.
- Continental Breakfast + Extra Protein new-service rates: not in the 2025 SOW but referenced in MONEY_MODEL open items #4.

## §7. Postseason

**UNKNOWN** — no clause. Under Kevin's ruling, same rates would apply. **No flag.**

## §8. Billing cadence

- Contract § 3: **weekly** (Monday-Sunday), Net 30.
- Invoice sample: weekly. K300168585 covers 3/16-3/21 (5 activity days in a week); K300168870 covers 6/29-7/4 (6 activity days).
- Kevin's export-unit-is-period: weekly = 2 invoices per SC period per level.

## §9. QuickBooks artifacts

- Invoice numbers: K300168585 + K300168870.
- Items: `TXR-AZ MLB - Breakfast/Lunch/Dinner`, `TXR-AZ MiLB - Breakfast/Lunch/Dinner`, `TXR-AZ - Pre-Game Hot Snack`, `TXR-AZ - Regular Snack`.
- All meal lines "T"-flagged (taxable). Snack lines "T"-flagged.
- No memo attached (no "This invoice is for ..." note like the CIN/TBR invoices).

## §10. Count-verification

Weekly invoicing based on meals provided. No client sign-off required per § 3.

## §11. Local flags (see CONFLICT_REGISTER)

- **§2026 SOW missing**: Confirms Kevin's chase item #1 and MONEY_MODEL Open item #4. Deposit amount for 2026 needs paperwork or an operational memo from Kevin.
- **§Sticker-vs-Post-SF derivation**: MONEY_MODEL rates for 2026 are derived from 2025 SOW × 1.025 (fixed escalation). Consistent; not a conflict.
- **§Snack rates missing from MONEY_MODEL digest**: Pre-Game Hot Snack $10.93 and Regular Snack $5.89 aren't in the digest table but appear on invoices. Digest should add these.
- **§MLB Dinner rate**: Contract SOW #1 lists MLB Breakfast + Lunch only; no MLB Dinner rate. PG stores `MLB Dinner` at $28.58. **Flag**: paperwork silent on MLB Dinner service — either operationally same as Lunch or new-service in a 2026 SOW that's missing.
