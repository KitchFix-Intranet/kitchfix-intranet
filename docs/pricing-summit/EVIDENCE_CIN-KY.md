# EVIDENCE — CIN - KY

> Read-only evidence pack for the pricing summit. Verbatim + cites. UNKNOWN where silent. Flag-don't-resolve.
>
> **Account**: CIN - KY (Louisville Bats — Reds AAA affiliate, Louisville Slugger Field). Shape: **No-SF pure per-meal**. Level: AAA (`billing_model=actuals_drive_invoice`, `has_homestand_schedule=true`).

## §1. Sources

- **Contracts**:
  - `/Users/kevinfietek/Documents/Claude /Contracts/CIN KY/KitchFix_2026LouisvilleAgreement_4.22.26.pdf` — Effective 4/21/2026, expires 12/31/2026, executed Nicholas Krall + Josh Katt (PRIMARY 2026).
  - `/Users/kevinfietek/Documents/Claude /Contracts/CIN KY/BATS 2025 Contract.pdf` — 2025 (historical).
  - `/Users/kevinfietek/Documents/Claude /Contracts/CIN KY/BATS Contract Executed Final.pdf` — prior executed (historical).
- **Invoices in sample**: NONE for CIN-KY.
- **MONEY_MODEL digest row**: `CIN - KY | No-SF | $25.95 (uniform) | $25.95 | none | Yes, meal revenue`.
- **PG**: `billing_model = actuals_drive_invoice`, `has_homestand_schedule = true`, `level = AAA`.

## §2. Contract evidence (verbatim, 2026 executed)

### 2.1 Structure — pure per-meal (§ 4)a) p.2)

> "Team will be billed weekly based on meals ordered for the prior week. Per meal rates are based on the type of meal served and are not inclusive of applicable sales tax."

### 2.2 Per-meal rates 2026 (§ 4)a) p.2)

> "i. Type 1 - Breakfast or Lunch Buffet: $25.95/ Meal ii. Type 2 - Snack / Lighter Meal - $8.64/ Meal"

### 2.3 Annual estimate (§ 4)b) p.2)

> "Based on the 2026 service calendar provided by Team (attached) for the arrival and mini-meal, Provider estimates the total annual investment to be $186,462.00 + applicable taxes."

### 2.4 SOP-linked re-price (§ 5 trailing paragraph, p.2)

> "The per meal rates defined in Section 3 are based on the Standard Operating Procedures in Exhibit A. Should the Club request material changes to the Meal Guidelines in Exhibit A, the parties agree to mutually revisit per meal pricing in good faith."

### 2.5 Guaranteed usage (§ 5)a)i p.2)

> "Team will utilize Provider services for every arrival and mini meal for the duration of the Term."

### 2.6 Post-game deferral (§ 5)a)ii p.2)

> "After observing and experiencing the first and second homestand's stadium operations in the co-used kitchen, the parties will discuss the possibility of expanding into post-game service at the beginning of May."

### 2.7 Outside-catering + lost-product (§ 5)a)iv-v p.2)

> "Kitchfix recognize that at times, some outside catering will be ordered with minimal notice (i.e. a MLB Rehab Player wants to buy dinner for the team). Kitchfix ask that notice be 72 hours of any outside catering and KitchFix use best efforts to utilize our product for another meal."

> "Should notice be given after the meal in question is less than 72 hours from being served, KitchFix reserves the right to seek compensation for the cost of any lost product (especially if that outside catered meal is at the end of a homestand and cannot be repurposed)."

### 2.8 Termination refund (§ 2)b) p.1)

> "In the event of termination of this Agreement, the Club shall pay the portion of the applicable Services Fees due for the period in which Services were rendered ... If the Club have prepaid any portion of the Services Fees, then Kitchfix shall refund the amount of the prepayment within five (5) business days of effective date of the Club' termination of this Agreement."

### 2.9 Tax language

> "Per meal rates are based on the type of meal served and are not inclusive of applicable sales tax." (§ 4)a) p.2)

> "Provider estimates the total annual investment to be $186,462.00 + applicable taxes." (§ 4)b) p.2)

**Pre-tax pricing explicit.**

### 2.10 Coffee/beverage line (Exhibit A p.8)

> "The following items do NOT need to be provided, as they are provided by the Louisville Bats: Snack items/granola bars, drinks (coffee, milk, etc.), paper products (except for mini-meal packaging), silverware, basic condiments, cold cereals, deli sandwich items."

**No coffee/fountain revenue line at CIN-KY** (Bats self-provide).

### 2.11 SF / Escalation / Postseason / Deposits / True-up / MLB-separation / Passthrough

- SF: **NONE** (pure per-meal).
- Escalation clause: UNKNOWN (single-year 2026, no CPI language).
- Postseason: UNKNOWN.
- Deposit/prepayment: **NONE** in the executed 2026 contract (the $24,000 lump-sum prepay clause from the DRAFT was REMOVED before execution — noted in `SC_CONTRACT_BILLING_SUMMARY.md`; a comparison to the DRAFT is beyond this pack's scope but preserved as a historical note).
- Net-payment terms: UNKNOWN (not stated in executed 2026 agreement).
- True-up / reconciliation on the $186,462 estimate: UNKNOWN.
- MLB-vs-MiLB invoice separation: N/A (AAA-only account, no MLB service).
- Passthrough: UNKNOWN (no food/supply/equipment passthrough budget; all costs baked into per-meal rate).

## §3. Invoice evidence

**No CIN-KY invoice in the 9-invoice sample from CEO 2026-07-14.**

## §4. PG evidence

Excerpt from PG dump:

| account_key | service | is_flat_fee | is_tax_free | price_kind | price |
|---|---|---|---|---|---|
| CIN - KY | Breakfast Buffet | | | projected | 25.95 |
| CIN - KY | Lunch Buffet | | | projected | 25.95 |
| CIN - KY | Snack | | | projected | 8.64 |
| CIN - KY | Post-Game (planned) | | | projected | 25.95 |
| CIN - KY | Umpire | | | projected | 25.95 |

`sc_fee_schedule`: no row for CIN-KY (per-meal only, correct).

## §5. Cross-check against MONEY_MODEL

| MONEY_MODEL claim | Contract | Verdict |
|---|---|---|
| $25.95 uniform (Breakfast/Lunch/Post-Game/Umpire) | Contract § 4)a) has Type 1 Buffet $25.95 + Type 2 $8.64 only. MONEY_MODEL lists "Post-Game / Umpire" at $25.95 — matches by category but the contract's "Type 1" naming vs MONEY_MODEL's category-labeling is a naming (not price) delta. | ✓ price agreed; naming difference informational. |
| Snack $8.64 | ✓ verbatim | ✓ |
| No SF | ✓ verbatim | ✓ |
| $186,462 est | ✓ verbatim | ✓ |

## §6. UNKNOWN / gaps

- Net-payment days on the executed 2026 contract.
- Escalation / CPI (single-year contract).
- Postseason rates.
- Year-end reconciliation vs $186,462 estimate.

## §8. Postseason (verbatim)

Contract silent on formal MiLB postseason billing rates. Post-game service is a separate operational discussion:

> "After observing and experiencing the first and second homestand's stadium operations in the co-used kitchen, the parties will discuss the possibility of expanding into post-game service at the beginning of May." (§ 5)a)ii p.2)

Per Kevin's default ruling (same rates on additional days), any Bats MiLB postseason would default to Type 1 $25.95 / Type 2 $8.64. No flag; contract silent.

## §9. Billing cadence

Contract § 4)a) p.2: "Team will be billed weekly based on meals ordered for the prior week." **Weekly.**

**No CIN-KY invoice in the sample** — cannot confirm weekly practice via invoice.

Kevin's export-unit-is-period ruling vs contracted weekly: each SC period ≈ 2 CIN-KY invoices.

## §10. QuickBooks artifacts

No CIN-KY invoice in sample; QB structure UNKNOWN. Expected to follow the same Sebastian scheme (K3 prefix, Item = e.g., `BATS - Buffet` or similar; "T" for taxable meals).

## §11. Count-verification

Contract silent on count sign-off. Section 4)a) has KitchFix bill "based on meals ordered for the prior week" — an ordering-based model. **No client-signoff-required clause.**

## §12. Local flags

- **§Type-labeling**: Contract labels "Type 1 Buffet" / "Type 2 Snack". MONEY_MODEL uses `Breakfast/Lunch/Post-Game/Umpire` (all @$25.95). Not a conflict — the contract Type-1 rate maps to any of the MONEY_MODEL categories; ACCOUNT_SERVICES_BRIEF has the full mapping. Flagged for language consistency at the summit.
- **§Draft-vs-Executed deletion**: the $24,000 lump-sum prepay was in the DRAFT and REMOVED before execution. Consequential for SC projection assumptions if any were based on the draft. See MONEY_MODEL section referencing the removal.
