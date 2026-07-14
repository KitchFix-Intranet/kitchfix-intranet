# EVIDENCE — STL - MO

> Read-only evidence pack. Verbatim + cites. UNKNOWN where silent. Flag-don't-resolve.
>
> **Account**: STL - MO (St. Louis Cardinals MLB — Busch Stadium). **Shape: Flat_fee** (Meal Services + Road Food + passthrough). Level: MLB. `billing_model=flat_fee`, `has_homestand_schedule=true`.

## §1. Sources

- **Contract**: `/Users/kevinfietek/Documents/Claude /Contracts/STL MO/2025-27 Food Services Agreement St. Louis Cardinals + KitchFix.pdf` — Base agreement covering Busch Stadium MLB (Jupiter is amended via the STL-FL agreement).
- **Invoices in sample**: NONE for STL-MO.
- **MONEY_MODEL digest row**: `STL - MO | Flat_fee | n/a | n/a | $473,000/yr | Operational counts only, no $`.
- **PG**: `billing_model = flat_fee`, `has_homestand_schedule = true`. `sc_fee_schedule` carries $473,000 STL-MO row (2026-01-01, monthly-6 cadence).

## §2. Contract evidence (verbatim)

### 2.1 Total Fee (§ 2.a p.2)

> "Total Fee: The total annual fee payable to Contractor for the Services under this Agreement is $698,000 (the 'Annual Service Fee'), which Service Fee includes:
> i. $423,000 for meal services to be paid in six (6) monthly installments beginning on March 1 of each of the 2025, 2026 and 2027 calendar years.
> ii. $50,000 for 'Road Food Management' services, due annually on March 1 of each of the 2025, 2026 and 2027 calendar years.
> iii. $225,000, as the budget for the cost of food, packaging, and supplies. ..."

### 2.2 $225K food passthrough (§ 2.a.iii p.2)

> "iii. $225,000, as the budget for the cost of food, packaging, and supplies. Contractor will provide the Cardinals with monthly updates on budget tracking, but Contractor is not responsible for ensuring the budget limit. Any additional requests, changes in scope, or ingredient modifications may result in costs exceeding the budget estimate. Any savings realized will be solely the Cardinals' benefit."

### 2.3 Road Food Management (§ 1.b.iii p.1)

> "iii. The fee for this service is an additional $50,000, due annually on March 1st of each year (2025, 2026, and 2027). The Cardinals are fully responsible for paying all catering expenses while on the road."

### 2.4 CPI escalation (§ 2.d p.2)

> "d. Price Adjustment:
> i. 2026 Adjustment: Pricing for 2026 will be adjusted based on the Consumer Price Index for All Urban Consumers: Food Away from Home (CPI-U, CUUR0000SEFV). The August 2025 report (released in September) will serve as the basis for this adjustment.
> ii. 2027 Adjustment: Pricing for 2027 will be based on the same CPI index, applying the increase from the August 2026 report (released in September) to the adjusted 2026 pricing."

### 2.5 Postseason rates (§ 2.b p.2) — **VERBATIM**

> "b. Post Season: For Services needed during the Post Season, Contractor will bill the St. Louis Cardinals in the following ways:
> i. Post Season Game: $5,222.22
> ii. Post Season Workout Days: $2,777.78
> iii. Road Food Management: $600"

**Kevin's ruling test**: $5,222.22 × 81 = $423,000 = the meal-services annual fee. $5,222.22/game = **1/81 of the annual meal-services fee**. Same "pro-rata annual fee" mechanic as CIN-OH. Consistent with Kevin's ruling for a flat-fee account.

### 2.6 Contractor investment (§ 2.e p.2)

> "e. Contractor Investment
> i. Contractor will invest up to $60K in kitchen equipment and small wares to be used in the home clubhouse kitchen at Busch Stadium and/or the kitchen in Jupiter, FL. Any purchases will become the property of the St. Louis Cardinals."

### 2.7 Tax language (§ 2.c p.2)

> "c. Sales Tax: All figures provided are subject to local sales tax, which will be applied and itemized on each invoice."

### 2.8 Termination fees (§ 3.b.ii pp.2-3)

> "(A) if the effective date of such termination for convenience ('TFC Date') is during the 2025 calendar year, the Cardinals shall pay to Contractor a termination fee of $60,000 upon the TFC Date, (B) if the TFC Date is during the 2026 calendar year, the Cardinals shall pay to Contractor a termination fee of $40,000 upon the TFC Date, and (C) if the TFC Date is during the 2027 calendar year, the Cardinals will pay to Contractor a termination fee of $20,000 upon the TFC Date."

### 2.9 Fee immutability / true-up

For passthrough: "Contractor is not responsible for ensuring the budget limit ... Any savings realized will be solely the Cardinals' benefit" (§ 2.a.iii). SF-level true-up: **UNKNOWN** — contract silent.

### 2.10 MLB-vs-MiLB invoicing

**N/A** — STL-MO covers MLB only (Busch Stadium). Spring Training + FSL are separate (STL-FL).

### 2.11 Count-verification

Contract silent on Cardinals sign-off. **No sign-off required.**

## §3. Invoice evidence

**No STL-MO invoice in the 9-invoice sample.**

## §4. PG evidence

`sc_fee_schedule`:

| account_key | amount | effective_date | period_type | payment_cadence |
|---|---|---|---|---|
| STL - MO | 473,000 | 2026-01-01 | annual | monthly-6 |

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Verdict |
|---|---|---|
| $473K (=$423K meal + $50K road) | ✓ verbatim § 2.a | ✓ |
| $225K passthrough excluded | ✓ verbatim § 2.a.iii | ✓ |
| 6 monthly installments Mar+ for meal services | ✓ verbatim § 2.a.i | ✓ |
| Road Food annual Mar 1 | ✓ verbatim § 2.a.ii | ✓ |
| CPI-U Food Away from Home (CUUR0000SEFV) Aug-to-Aug | ✓ verbatim § 2.d.i | ✓ |
| Postseason $5,222.22/game + $2,777.78/workout + $600 road food | ✓ verbatim § 2.b | ✓ |
| "The old '$489,431' figure was a CPI-escalated version of this $473K service portion" | Not disprovable from contract; contract only defines the CPI-adjustment mechanism. Historical claim stands. | ✓ informational |
| "The '$698K' is the contract gross including passthrough - store $473K" | ✓ verbatim § 2.a ($698K = $423K + $50K + $225K) | ✓ |

## §6. UNKNOWN / gaps

- 2026 CPI-adjusted fee (starting from $473K): UNKNOWN — depends on Aug 2024→Aug 2025 CPI change.
- Contractor $60K investment: MONEY_MODEL doesn't call this out; it's a one-time KitchFix outlay that becomes Cardinals property.
- Net-N days on invoices: UNKNOWN in contract.
- SF-level true-up: UNKNOWN.

## §7. Postseason

See § 2.5 verbatim. $5,222.22/game = 1/81 of $423K meal-services annual fee. **Same mechanic as CIN-OH** (pro-rata annual fee). Consistent with Kevin's "same rate + additional days" doctrine. **No flag.**

## §8. Billing cadence

- Meal services SF: 6 monthly Mar-Aug (=6 SF invoices/yr)
- Road Food: annual Mar 1 (=1 invoice/yr)
- Passthrough: monthly budget tracking per § 2.a.iii; specific invoice cadence not stated (UNKNOWN — reasonable inference is monthly reimbursement).
- **No STL-MO invoice in sample** — cannot verify QB practice.
- Kevin's export-unit-is-period ruling vs contract: SF monthly ≈ 2 SC periods per SF invoice; passthrough is monthly. Per-period export would need to aggregate.

## §9. QuickBooks artifacts

**Cannot verify from sample.** Expected to follow K3 prefix + Sebastian scheme. `Item` field likely encodes `STL MLB - Services Fee`, `STL MLB - Road Food Management`, `STL MLB - Passthrough` or similar.

## §10. Count-verification

Not required. Flat-fee model.

## §11. Local flags (see CONFLICT_REGISTER)

- **§road-food-$600-postseason**: Contract § 2.b.iii states "Road Food Management: $600" during Post Season. MONEY_MODEL Postseason table lists "Road Food $600" — consistent. No flag.
- **§contractor-investment**: Contract § 2.e says Contractor invests up to $60K in kitchen equipment. Not in MONEY_MODEL. Not a conflict; informational.
