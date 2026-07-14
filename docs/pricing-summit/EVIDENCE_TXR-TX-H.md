# EVIDENCE — TXR - TX - H

> Read-only evidence pack. Verbatim + cites. UNKNOWN where silent. Flag-don't-resolve.
>
> **Account**: TXR - TX - H (Texas Rangers Home clubhouse — Globe Life Field MLB). **Shape: Flat_fee** ($604,032 annual). Level: MLB. `billing_model=flat_fee`, `has_homestand_schedule=true`.

## §1. Sources

- **Contract**: `/Users/kevinfietek/Documents/Claude /Contracts/TXR H&V/Food_Services_Agreement_-_KitchFix_(MLB_2026).pdf` — Effective Jan 21, 2026. 2026-only (single season).
- **Also on folder**: `TXR H&V/Texas Rangers 2025 MLB Food Service Contract.pdf` (2025, historical), `Food Services Agreement - KitchFix (MLB 2024).docx` (2024, historical).
- **Invoices in sample**: NONE for TXR-TX-H.
- **MONEY_MODEL digest row**: `TXR - TX - H | Flat_fee | n/a | n/a | $604,032/yr | Operational counts only, no $`.
- **PG**: `billing_model = flat_fee`, `has_homestand_schedule = true`. `sc_fee_schedule` carries $604,032 TXR-TX-H row (2026-01-01, monthly-6 cadence).

## §2. Contract evidence (verbatim)

### 2.1 Services Fee (§ 2.a p.1)

> "Services Fee. During the Term (defined below), the Rangers shall pay Contractor $604,032.00 (the 'Services Fee') as payment in full for the Services and all ingredients and supplies required for Meal preparation, delivery, service and clean-up."

### 2.2 Payment cadence (§ 2.a pp.1-2) — **VERBATIM TABLE**

> "The Services Fees are due in six (6) payments on the following dates:
> Payment Due Date | Pre-Sales Tax Payment Amount | With Sales Tax Payment Amount
> April 1, 2026    | $100,672.00 | $108,977.44
> May 1, 2026      | $100,672.00 | $108,977.44
> June 1, 2026     | $100,672.00 | $108,977.44
> July 1, 2026     | $100,672.00 | $108,977.44
> August 1, 2026   | $100,672.00 | $108,977.44
> September 1, 2026 | $100,672.00 | $108,977.44"

> "Contractor agrees to invoice the Rangers thirty (30) days in advance of each due date."

**Sales tax rate implied**: $108,977.44 / $100,672.00 = 1.0825 → **8.25%** (Arlington TX).

### 2.3 Postseason (§ 2.a p.2) — **VERBATIM POSTSEASON**

> "In addition to the foregoing, the Rangers shall pay Contractor a pro rata Services Fee for each 2026 Postseason Game."

**Note**: contract does NOT state a per-game denominator. MONEY_MODEL's "~$7,457.93" figure = $604,032/81 = $7,457.93 derived. **Consistent with Kevin's ruling** (pro-rata annual fee = "same rate + additional days" for a flat-fee account). Contract silent on workout-day rate.

### 2.4 Catering (outside meals) — Rangers-paid passthrough (§ 2.b p.2)

> "Catering. Contractor shall coordinate and order twelve (12) post-game outside catered meals during the Term, which shall relieve Contractor of its need to provide buffet or made-to-order food for those post-game meals, but Contractor shall be required to provide its standard all-day food offerings and have an attendant present on those dates to maintain the dining room and properly close down post service. The Rangers shall be responsible for the costs of such outside catered meals."

### 2.5 Kitchen setup budget — DANGLING REFERENCE (§ 1.c p.1)

> "Contractor agrees to provide reasonable assistance and consultation to the Rangers to set up (within the budget set forth below in Section 2(d)) and maintain the new permanent kitchen facilities at Globe Life Field"

**Section 2(d) does not exist in the executed contract.** Section 2 contains only (a) Services Fee and (b) Catering. **Missing subsection — flag.**

### 2.6 Tax language

> "Contractor's Services Fees are not inclusive of sales tax, if applicable." (§ 2.a p.2)

Payment table shows both pre-tax and with-tax columns — pre-tax model.

### 2.7 Amendment lock (§ 11 p.6)

> "The parties hereto shall not amend, modify, or supplement this Agreement, except by written instrument signed by both parties hereto."

### 2.8 Termination true-up (§ 3.b p.2)

> "the Rangers may terminate this Agreement at any time and for any reason by providing Contractor with at least thirty (30) days' prior written notice and paying the pro-rata portion of the applicable Services Fee(s) through the end of the notice period. In the event of termination of this Agreement, the Rangers shall pay the portion of the applicable Services Fees due for the period in which Services were rendered (less any damages due to Contractor's breach, as the case may be), but shall not be responsible for the remainder of the applicable Services Fees for the Term."

### 2.9 Additional services true-up (§ 1.a p.1)

> "Contractor shall also be available to perform additional Services on an as-needed basis from time to time during the Term upon reasonable advance notice by the Rangers. Upon such reasonable advanced notice, the parties shall negotiate in good faith and in an expeditious manner to mutually agree upon an acceptable fee to be paid by the Rangers to Contractor for such additional Services."

### 2.10 Meal-count scope (§ 1.b p.1)

> "Contractor agrees to prepare three (3) meals per Game for sixty (60) people."

### 2.11 CPI / escalation

**UNKNOWN** — single-season contract, no CPI clause.

### 2.12 True-up / immutability

No SF-level reconciliation clause (only additional-services + termination pro-rata). **UNKNOWN** on true-up.

### 2.13 Count-verification

Contract scope-caps meals at "three (3) meals per Game for sixty (60) people". Not a sign-off gate. **No sign-off required.**

### 2.14 MLB-vs-MiLB invoicing

**N/A** — MLB-only.

## §3. Invoice evidence

**No TXR-TX-H invoice in the 9-invoice sample.**

## §4. PG evidence

`sc_fee_schedule`:

| account_key | amount | effective_date | period_type | payment_cadence |
|---|---|---|---|---|
| TXR - TX - H | 604,032 | 2026-01-01 | annual | monthly-6 |

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Verdict |
|---|---|---|
| $604,032/yr fee | ✓ verbatim § 2.a | ✓ |
| 6 monthly installments Apr-Sep | ✓ verbatim § 2.a table | ✓ |
| No escalation (direct 10% YoY vs 2025 $549,120) | Contract silent on CPI; single-season 2026 contract | ✓ derived from year-over-year comparison, not from CPI clause |
| Postseason "pro rata Services Fee per game (~$7,457.93)" | ✓ verbatim § 2.a "pro rata Services Fee for each 2026 Postseason Game"; $7,457.93 = $604,032/81 derivation NOT in contract | ✓ agreement on mechanic; per-game denominator IS derivation |
| Single-year 2026 contract | ✓ 2026 dates only | ✓ |

## §6. UNKNOWN / gaps

- **§ 2(d) kitchen setup budget**: referenced at § 1.c but the referenced subsection does not exist. Budget amount UNKNOWN.
- Postseason workout-day rate: UNKNOWN (contract silent).
- Postseason per-game DENOMINATOR: contract says "pro rata" without specifying $/game. MONEY_MODEL's $7,457.93 is a derivation ($604,032/81).
- 2027 contract: UNKNOWN (contract is single-year 2026).

## §7. Postseason

See § 2.3 verbatim. "Pro rata Services Fee for each 2026 Postseason Game" — flat-fee pro-rata mechanic. Compatible with Kevin's ruling.

## §8. Billing cadence

- Contract: 6 monthly SF invoices Apr-Sep, invoiced 30 days in advance.
- No TXR-TX-H invoice in sample.
- Kevin's export-unit-is-period ruling: monthly SF = ~2 SC periods per SF invoice.

## §9. QuickBooks artifacts

**Cannot verify from sample.** Expected K3 prefix, `Item = TXR-H MLB - Services Fee` or similar.

## §10. Count-verification

Not required — flat fee.

## §11. Local flags (see CONFLICT_REGISTER)

- **§Section-2(d) missing**: contract references § 2(d) at § 1.c but § 2 has no subsection (d). Kitchen setup budget amount is not documented. **Flag for chase.**
- **§Postseason denominator not in contract**: "pro rata Services Fee" — the specific "1/81" is a derivation, not contract text. Not a conflict but note for the pricing summit.
- **§2027 unknown**: contract is single-year 2026. Renewal terms not specified in the 2026 contract.
