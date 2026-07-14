# EVIDENCE — STL - FL

> Read-only evidence pack. Verbatim + cites. UNKNOWN where silent. Flag-don't-resolve.
>
> **Account**: STL - FL (St. Louis Cardinals — Jupiter FL / Roger Dean Chevrolet Stadium / PDC). **Shape: Flat_fee** (Florida Services fee, quarterly). **Level: PDC promoted to fee**. `billing_model=flat_fee`, `has_homestand_schedule=false`, `has_schedule_overlay=true`.

## §1. Sources

- **Contract**: `/Users/kevinfietek/Documents/Claude /Contracts/STL FL/KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.pdf` — Amendment to Nov 26, 2024 Food Services Agreement, executed 10/14/2025 (docx also present).
- **Invoices in sample**: **K300168343** — 2026-07-01 STL-FL quarterly SF installment "4 of 4 (Final)".
- **MONEY_MODEL digest row**: `STL - FL | Flat_fee | n/a ($0 in PG) | n/a | $1,400,000/yr | Operational counts only, no $ (fee-no-dollar variant)`.
- **PG**: `billing_model = flat_fee`, `has_schedule_overlay = true`. `sc_fee_schedule` carries $1,400,000 STL-FL row (2026-01-01, quarterly cadence).

## §2. Contract evidence (verbatim)

### 2.1 Total Annual Fee structure (§ 2.a p.1)

> "Total Annual Fee: The total annual fee payable to Contractor for the Florida Services is $2,300,000 (the 'Total Annual Fee'), which consists of the following:
> i. $1,400,000 for the Florida Services, payable in quarterly installments on the following dates:
> 1. November 1, 2025;
> 2. February 1, 2026;
> 3. May 1, 2026;
> 4. August 1, 2026, and
> 5. In accordance with Section 2(c) hereof for 2027."

### 2.2 Passthrough — $900,000 food/packaging/supplies (§ 2.a.ii pp.1-2)

> "ii. $900,000 as the budget for the cost of food, packaging, and supplies. Contractor will provide the Cardinals with bi-monthly invoices for these expenses, in addition to receipts, and at no time will charge more than the exact costs for said items. Contractor will provide Cardinals with monthly updates on budget tracking, but Contractor shall not be responsible for ensuring the budget limit. Any additional requests, changes in scope, or ingredient modifications may result in costs exceeding the budget estimate. Any savings realized will be solely the Cardinals' benefit."

### 2.3 Ongoing upkeep — $30K envelope (§ 2.b p.2)

> "b. Ongoing annual upkeep expenses for the Florida Services:
> i. $15,000/year equipment budget and/or potential repair budget of up to $15,000, which shall roll over if unused;
> ii. $4,000/year for storage pod rental; and
> iii. $11,000/year for temporary cooler storage (during Spring Training only) plus necessary electrical hook-ups."

### 2.4 2027 work-stoppage / lock-in (§ 2.c.ii p.2)

> "ii. The Cardinals shall pay Contractor the first quarterly Florida Services installment of the Total Annual Fee for 2027, in the amount of $350,000 plus applicable taxes, on November 1, 2026. Such payment shall be deemed earned in full by Contractor and shall cover Contractor's fixed costs and readiness obligations for the period of January 1 through March 31, 2027, regardless of whether the Florida Services are performed during such period, in whole or in part."

### 2.5 Work-stoppage 50% standby (§ 2.c.iii p.2)

> "iii. If any work stoppage continues beyond March 31, 2027, and no Florida Services are being provided by Contractor at Roger Dean Chevrolet Stadium, then the Cardinals shall pay to Contractor on April 1, 2027, a standby installment equal to fifty percent (50%) of the second quarterly Florida Services installment (i.e., $175,000 plus applicable taxes)."

### 2.6 2027 fully-resumed clause (§ 2.c.iv p.2)

> "iv. If, however, any Florida Services are provided by Contractor after March 31, 2027 ... then the Cardinals shall pay Contractor the full second quarterly Florida Services installment (i.e., $350,000 plus applicable taxes) on April 1, 2027, subject to the parties making an equitable adjustment to account for reduced quantities and/or quality of food and beverage service in absence of any Major League players ..."

### 2.7 Tax language (§ 2.d p.3)

> "d. Sales Tax: All figures provided are subject to local sales tax, which will be applied and itemized on each invoice."

Also "plus applicable taxes" on 2027 $350K + $175K clauses.

### 2.8 Payment terms

- Florida Services fee: quarterly Nov 1 / Feb 1 / May 1 / Aug 1 (§ 2.a.i above)
- Food/packaging/supplies: bi-monthly with receipts (§ 2.a.ii above)
- **UNKNOWN** on Net-N days specifically — Amendment doesn't state.

### 2.9 Postseason

**UNKNOWN** — no explicit postseason clause. The 2027 lock-in clauses address work-stoppage, not postseason play at Roger Dean (which is Spring Training + FCL + STL affiliates, not MLB regular-season postseason).

### 2.10 Escalation / CPI

**UNKNOWN** — no CPI clause in the Amendment for the Florida Services fee itself. The 2027 first-quarter payment ($350K) is stated as an absolute number, not CPI-derived.

### 2.11 Fee immutability / true-up

Work-stoppage lock-in clause (§ 2.c.ii): first-quarter 2027 payment "deemed earned in full ... regardless of whether the Florida Services are performed during such period, in whole or in part" — **no true-up mechanic for that installment**. For the passthrough budget: overage handled per § 2.a.ii ("Contractor shall not be responsible for ensuring the budget limit ... Any savings realized will be solely the Cardinals' benefit"). SF-level true-up: UNKNOWN.

### 2.12 MLB-vs-MiLB separate invoicing

**N/A** — Jupiter Complex covers MLB Spring Training + FSL Palm Beach Cardinals + FCL. Single flat fee for all Florida Services.

### 2.13 Count-verification

Amendment does not require Cardinals sign-off on meal counts before invoicing. **No sign-off gate.**

## §3. Invoice evidence (verbatim)

### 3.1 Invoice K300168343 — 2026-07-01

- **Bill To**: St. Louis Cardinals / Jupiter, FL / Linda Brauer
- **Invoice Date**: 07/01/2026
- **Due Date**: 08/01/2026 (Net 30)
- **Total**: $350,000.00 (BALANCE DUE $325,500.00 after $24,500 prior payment applied)
- **Line item**:
  > "Service Fees (PFS) | 2026 Service Fee - 4 of 4 (Final) | Qty 1 | Rate 350,000.00 | Amount 350,000.00"
- **Tax**: TAX 0.00 (untaxed; no "T" flag on this line)
- **No memo/note attached** on this invoice.

**Amount match**: $350,000 × 4 = $1,400,000/yr = MONEY_MODEL digest **EXACT MATCH** for Florida Services fee (passthrough excluded).

**Timing** vs contract:
- Contract § 2.a.i lists quarterly installments Nov 1 / Feb 1 / May 1 / Aug 1.
- Invoice K300168343 dated 07/01/2026 with due 08/01/2026 = **matches** the "August 1" installment, invoiced 30 days in advance.
- Marked "4 of 4 (Final)" — Nov 1 2025 (1), Feb 1 2026 (2), May 1 2026 (3), Aug 1 2026 (4). Consistent.

## §4. PG evidence

`sc_fee_schedule`:

| account_key | amount | effective_date | period_type | payment_cadence |
|---|---|---|---|---|
| STL - FL | 1,400,000 | 2026-01-01 | annual | quarterly |

`sc_service_prices`: STL-FL per-meal prices held at $0 (per MONEY_MODEL §g "STL-FL zeroed 2026-06-16").

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Invoice | Verdict |
|---|---|---|---|
| $1.4M/yr fee | ✓ verbatim § 2.a.i | ✓ $350K × 4 quarterly | ✓ |
| Quarterly Nov 1 / Feb 1 / May 1 / Aug 1 | ✓ verbatim § 2.a.i | ✓ Aug 1 installment (4/4) observed | ✓ |
| $900K food passthrough EXCLUDED from revenue | ✓ verbatim § 2.a.ii | (invoice K300168343 has no passthrough line; expected on separate invoice) | ✓ |
| $15K/$4K/$11K upkeep "KitchFix-borne expense/budget lines, not revenue - excluded" (MONEY_MODEL §h) | Contract § 2.b names these as "Ongoing annual upkeep expenses for the Florida Services". Wording is AMBIGUOUS on who bears them. See §7 flag. | not in invoice sample | **FLAG** |
| 2027 work-stoppage $350K full / $175K half | ✓ verbatim § 2.c.ii/iii | (2027, out of sample) | ✓ |

## §6. UNKNOWN / gaps

- CPI escalation on the $1.4M fee: UNKNOWN.
- Postseason rates: N/A (Spring Training complex; not applicable).
- Net-N days for quarterly SF invoicing: Contract doesn't specify; invoice sample shows Net 30 (due 08/01, invoiced 07/01).
- SF-level true-up between $1.4M and actual seasonal cost: UNKNOWN.

## §7. Postseason

**UNKNOWN / N/A** — Roger Dean Complex hosts Spring Training + FSL Palm Beach + FCL affiliates; no MLB regular-season postseason play at Jupiter. Contract silent on postseason rates. No flag against Kevin's "same rate on additional days" doctrine.

## §8. Billing cadence

- **Contract**: quarterly for the SF fee (§ 2.a.i); bi-monthly for the food/packaging passthrough (§ 2.a.ii); upkeep budgets annual (§ 2.b).
- **Invoice sample**: K300168343 is a **quarterly** installment invoice for the SF only. Passthrough invoices not present in the sample.
- Kevin's export-unit-is-period ruling vs contract: STL-FL SF is 4 invoices/year (very sparse relative to SC's bi-weekly period). Passthrough is bi-monthly = ~1 per SC period. Per-period export for STL-FL may need to bundle SF prorated + passthrough actuals, or export SF quarterly and passthrough per-period separately.

## §9. QuickBooks artifacts

- Invoice number: `K300168343` — same K3 prefix scheme.
- Line-item `Item`: `Service Fees (PFS)` — **PFS** likely = "Player Food Service" or Jupiter-specific code.
- Description: "2026 Service Fee - 4 of 4 (Final)" — Sebastian's memo convention encodes installment sequence.
- **No "T" flag on the SF line** — the $1.4M fee itself is taxable per contract § 2.d ("All figures provided are subject to local sales tax") but this invoice shows TAX 0.00. Two possible readings: (a) Sebastian issues a tax-exclusive invoice and tax lives elsewhere / prior payment; (b) STL-FL SF is treated as tax-exempt at the service level despite contract clause. **Flagged in CONFLICT_REGISTER.**
- Balance-due arithmetic: Total $350,000 − Prior Payment $24,500 = Balance Due $325,500. The $24,500 "prior payment applied" is unexplained on this invoice.

## §10. Count-verification

Not required. Flat-fee model; meal counts not billed.

## §11. Local flags (see CONFLICT_REGISTER)

- **§upkeep-ownership**: Contract § 2.b names $15K + $4K + $11K as "annual upkeep expenses for the Florida Services". MONEY_MODEL §h calls these "KitchFix-borne expense/budget lines, not revenue — excluded". Contract wording is ambiguous — a "budget" in this contract's grammar typically means Cardinals-funded (see § 2.a.ii where "budget" = passthrough). This wording read literally would suggest Cardinals reimburse $30K/yr for equipment/storage on TOP of the $1.4M. Flag as CONFLICT.
- **§invoice-tax-zero**: The invoice K300168343 shows TAX 0.00 on the $350K SF installment despite contract § 2.d requiring sales tax. Two-line invoice pattern (SF gross + tax) is expected but the invoice shows one line + zero tax. Flag.
- **§prior-payment-$24,500**: Unexplained on the invoice. Presumably a prior partial payment applied. Not a conflict; informational.
