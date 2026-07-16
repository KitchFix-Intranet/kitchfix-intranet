# ACCOUNT: STL-FL
> Canonical record. Current-state above the fold; history preserved below (§6). Primary key is the intranet account name. Reasoning/decisions journaled in `../LEDGER.md`; verbatim contract terms in `../CONTRACT_DIGEST_STL-FL.md`.

## 0. IDENTITY & ALIASES (the crosswalk — join everything on the primary key)
- **Primary key (intranet)**: `STL-FL`
- **Team / entity**: St. Louis Cardinals — Jupiter, FL (Roger Dean Chevrolet Stadium PDC: MLB Spring Training + MiLB ST + Palm Beach Cardinals + FCL)
- **Level / tier**: PDC
- **Search aliases**: "Cardinals FL", "Jupiter", "Roger Dean", "Palm Beach Cardinals", "PBC", "Cards spring training", "STL Florida"
- **Crosswalk to other systems**:
  | System | How this account appears |
  |---|---|
  | Intranet (PRIMARY) | `STL-FL` |
  | PG `accounts` | team_key `STL - FL` · name "St Louis Cardinals" · level `PDC` · billing_model `flat_fee` · has_schedule_overlay `true` |
  | PG `sc_fee_schedule` | $1,400,000 (2026-01-01, annual, quarterly cadence) |
  | PG `sc_service_prices` | per-meal rows all $0 (zeroed 2026-06-16; flat-fee planning only) — incl. "Fun Money allocation" ($0, is_non_revenue) |
  | QuickBooks (invoice `Item`) | SF: **"Service Fees (PFS)"** `[K300168340-343]` · **`PFS` = Performance Food Service** (KitchFix's parent/product-family brand — the code root on all Item names). `[Kevin, 2026-07-16]`|
  | Finance schedule | "STL - FL" — accrued P1-P12, billed 4× $350,000 `[§W]` |
  | P&L file | St. Louis Cardinals — Jupiter / FL rows |
  | ABR OneSheeter tab | NOT included (STL excluded from 2025 ABR) |
  | Contract folder | `/Contracts/STL FL/` (Amendment; base agreement lives in `/Contracts/STL MO/`) |
  | Invoice recipients | St. Louis Cardinals / Jupiter FL / **Linda Brauer** `[K300168343]` |
- **Client stakeholders**: **Carl Kochan** — top stakeholder (Jen & Linda's boss), ckochan@cardinals.com; **Jen Goldstein** — site contact, RD/Dietitian; **Linda Brauer** — Finance/AP, lbrauer@cardinals.com `[src: Kevin, 2026-07-16, high]`
- **Capture completeness**: **FULLY-CAPTURED (SF layer)** — Amendment banked, $1.4M fee finance-confirmed, SF non-taxable confirmed, quarterly cadence confirmed, the $24,500 credit mechanic explained, 2027 work-stoppage lock-in captured. Upkeep-ownership RESOLVED (Cardinals-reimbursed passthrough) and the full food/snack/beverage stream confirmed as reimbursable passthrough (Kevin). One honest gap: the passthrough reimbursable invoices weren't sampled (structure mirrors STL-MO's; see §2c).

## 1. CONTRACT (pointer, not duplication)
- **Operative doc**: `KitchFix Food Services Agreement Jupiter Complex fully executed 10.14.25.pdf` (+ .docx) — **Amendment** to the Nov 26, 2024 base agreement (which lives in `/Contracts/STL MO/`). Adds "Florida Services." Effective **Oct 3, 2025**, executed Oct 14, 2025. Haim Bloom (Cardinals President, Baseball Ops) + Josh Katt.
- **Verbatim source-of-record**: `../CONTRACT_DIGEST_STL-FL.md`.
- **Term / renewal**: inherits the base agreement's term (through **Dec 31, 2027**); the Florida Services layer runs through **Nov 19, 2027** conditional on the work-stoppage clause (§2.c.vii). · as-of 2026. `[digest §B.1]`
- **The base agreement** (STL-MO's `2025-27 Food Services Agreement`) is the "Agreement" this amends — defined terms carry over (§7). `[digest §A]`

## 2. BILLING RECORD (consumer: bill export / PG / finance)

### 2a. Money shape
- **Shape**: **Flat-fee** — a **$2,300,000 Total Annual Fee** split into a fixed **Florida Services fee ($1.4M)** + a **food/packaging/supplies passthrough ($900K)** + upkeep budgets ($30K). NO per-meal billing (meals tracked for planning; PG stores $0). `[MONEY_MODEL flat_fee; billing_model flat_fee]`
- **Florida Services Fee = $1,400,000** (finance §W + invoice-confirmed), billed **4 quarterly installments of $350,000**. · as-of 2026 · `[§W, digest §B.3]`
  - **This is the revenue-recognized fee.** The $900K passthrough + $30K upkeep are NOT part of this $1.4M (see §2c). PG `sc_fee_schedule` stores $1,400,000 — correct.
- **SF cadence**: quarterly — **Nov 1, 2025 / Feb 1, 2026 / May 1, 2026 / Aug 1, 2026** (§2.a.i). Accrued **P1-P12** per finance. Invoiced ~30 days ahead of due date. `[digest §B.3, §W]`
- **SF TAX: NON-TAXABLE** (bills TAX 0.00) — invoice-confirmed (K300168343: $350,000, TAX $0.00). Kevin ruled §U (A-6); reconfirmed Josh/Lessard Slack §Y. ⚠️ **This is the Cardinals' asserted legal position, not a settled exemption** — "defensible," pushed by the Cardinals' lawyers; if the state challenged it and won, **the Cardinals would bear the tax liability**. `[§U, §Y, §3.1 evidence]`
  - ⚠️ **CONTRAST with CIN-OH** (SF taxed 7.80%). Per-account SF-tax attribute — STL-FL exempt, CIN-OH taxed. `[§X]`
  - **BUT** — the FIRST installment (K300168340, Nov 2025) WAS billed with sales tax (~$24.5K), which was later **credited back**. See the credit mechanic below.
- **Escalation regime**: **NONE** in the Amendment — flat $2.3M for 2026 and 2027 (subject to the work-stoppage adjustments). The base agreement's CPI clause does NOT extend to the Florida Services fee. `[digest §B.4]`

### 2b. Rate table
> **Flat-fee account — no per-meal rate table.** PG stores per-meal services (MLB/MiLB ST, Palm Beach Cardinals, etc.) at **$0** (planning only; zeroed 2026-06-16). Includes a **"Fun Money allocation"** row ($0, `is_non_revenue`) — an internal team-event budget, excluded from revenue. The money is the Florida Services Fee (§2a) + passthrough (§2c).

### 2c. Passthrough / reimbursables (billed separately from the $1.4M, at cost)
**All food, snacks, and beverages at STL-FL are reimbursable passthrough** — KitchFix spends, the Cardinals reimburse (Kevin). This is the whole $900K stream, not just "food & packaging."
- **Food/snacks/beverages/packaging/supplies budget = $900,000** (§2.a.ii), billed **bi-monthly with receipts** at exact cost (no markup); savings revert to the Cardinals. OUT of the $1.4M fee and OUT of SC per-meal scope. `[digest §B.7, Kevin]`
  - ⚠️ **Passthrough invoices NOT sampled for STL-FL.** Structure mirrors STL-MO's reimbursables (single-line lump, tax-zero, at-cost). Confirm when an STL-FL reimbursable invoice is obtained. `[gap — §X]`
  - **Tax-zero** on reimbursables — tax is already paid to vendors on the underlying purchase invoices (the general reimbursable-tax rule; avoids double-tax). `[Kevin, §X]`
- **Ongoing upkeep budgets ($30K envelope)**: $15K/yr equipment-or-repair (rolls over if unused) + $4K/yr storage pod + $11K/yr temp cooler (ST only) + electrical. `[digest §B.7]`
  - ✅ **Upkeep-ownership RESOLVED (Kevin 2026-07-16): this is a Cardinals expense — a reimbursable passthrough. KitchFix spends, the Cardinals reimburse.** So the $30K sits on TOP of the $1.4M, reimbursed like the $900K stream (not KitchFix-borne). Supersedes the earlier MONEY_MODEL "KitchFix-borne" reading. `[Kevin]`

### 2d. The $24,500 credit mechanic (a real billing behavior)
- **Installment 1 (K300168340, Nov 2025) was billed WITH sales tax (~$24,500)** — before the SF was determined non-taxable.
- **The $24,500 credit was applied on installment 4** (K300168343), as a PAYMENT line → $325,500 balance. ⚠️ NOTE: the finance workbook (§W) placed the credit note on installment 3 (K300168342), but the actual invoice shows it landed on installment **4**. Client is credited either way (not a billing error); the finance-doc note is off by one installment — flag to Sebastian. `[K300168343 invoice = ground truth; §W note discrepancy]`
- On **installment 4 (K300168343)**, the $24,500 appears as a **"payment" line** ($350,000 total − $24,500 credit = $325,500 balance due). `[§X — Kevin confirmed: the $24,500 = the 2025 tax credit]`
- **Billing-mechanics fact**: KitchFix applies credits/offsets as a "payment" line against a future SF installment, NOT as a separate refund. The bill export must support credit lines against installments. `[§X]`

### 2e. Worked billing example (golden-test seed)
- **SF installment (invoice K300168343, 7/1/2026, "4 of 4 Final")**: $350,000 fee, **TAX 0.00**, minus $24,500 credit = **$325,500 balance due**. The SF export for an STL-FL quarter = $350,000 (non-taxable), with credit handling separate.
- Passthrough golden seed pending an STL-FL reimbursable invoice.

## 2f. 2027 work-stoppage lock-in (forward-looking, captured for completeness)
The Amendment §2.c pre-scripts 2027 payments around a possible MLB work stoppage:
- **$350,000 earned-in-full on Nov 1, 2026** (covers Jan 1–Mar 31, 2027 readiness regardless of whether services happen). Lands in FY2026 cash for a 2027 readiness period.
- If stoppage continues past Mar 31, 2027 with no services: **$175,000 standby** on Apr 1, 2027 (50% of Q2).
- If any services resume after Mar 31: **full $350,000** Q2 on Apr 1, 2027 (with equitable adjustment).
- Beyond June 30, 2027: payment structure lapses, parties meet-and-confer; no obligation beyond Nov 19, 2027 unless re-agreed. `[digest §B.3]`

## 3. OPERATIONS RECORD (consumer: OPD / SousAI / account management)
- **Client stakeholders**: **Carl Kochan** (top stakeholder, ckochan@cardinals.com); **Jen Goldstein** (site contact, RD/Dietitian); **Linda Brauer** (Finance/AP, lbrauer@cardinals.com). `[Kevin, high]`
- **Service pattern**: PDC — MLB Spring Training + MiLB ST + Palm Beach Cardinals (MiLB regular season) + FCL, at Roger Dean Chevrolet Stadium. Standard portions: 10oz protein / 6oz starch / 6oz veg; ST elevated to grass-fed/wild-caught/free-range/pasture-raised (Exhibit 3). `[digest §B.9]`
- **Facility**: Cardinals furnish kitchen space; Cardinals bear costs/delays if their new facility isn't ready on time (§1.b). `[digest §B.7]`
- **Count mechanics**: no client sign-off gate. `[digest]`
- **Reimbursable rhythm**: $900K food/packaging bi-monthly with receipts.

## 4. RULINGS & DECISIONS (current dispositions; full reasoning in LEDGER)
| ID | Ruling (current state) | Status | as-of | LEDGER ref |
|---|---|---|---|---|
| A-6 | STL-FL SF is **NON-TAXABLE** (bills TAX 0.00). Confirmed by invoice + Kevin ruling + Josh/Lessard Slack. Cardinals' asserted legal position; Cardinals bear the liability risk. | CLOSED | 2026-07-16 | §U, §Y |
| $24,500 credit | The "prior payment" on K300168343 = a 2025 tax-matter credit, applied as a "payment" line against the SF installment. Credits offset future installments (not separate refunds). | CLOSED | 2026-07-16 | §W, §X |
| Fee figure | 2026 Florida Services Fee = $1,400,000 (finance + invoice confirmed); $900K passthrough + $30K upkeep separate. | CLOSED | 2026-07-16 | §W |
| Upkeep ownership | The $30K upkeep envelope is a **Cardinals-reimbursed passthrough** (KitchFix spends, Cardinals reimburse) — NOT KitchFix-borne. | CLOSED | 2026-07-16 | Kevin |
| Full passthrough | ALL food/snacks/beverages at STL-FL are reimbursable passthrough (the $900K stream). | CLOSED | 2026-07-16 | Kevin |
| Reimbursable tax | Reimbursables bill tax-zero (tax paid to vendors already; avoids double-tax). General rule. | CLOSED | 2026-07-16 | §X |

## 5. OPEN ITEMS (what's not settled — owner + status)
| Item | Status | Owner | Blocking cert? | Note |
|---|---|---|---|---|
| $900K passthrough invoice | PENDING (accounting) | accounting | No | STL-FL reimbursable invoice not sampled. Structure inferred from STL-MO (single-line lump, tax-zero, at-cost). Confirm when obtained — the STL-FL $900K is the largest passthrough of the 11. |
| Finance-doc credit note placement | OPEN (minor) | Sebastian | No | The $24,500 credit note in the finance workbook (§W) sits on installment 3, but the credit actually applied on installment 4 (per invoice K300168343). Off-by-one in the finance doc; not a billing error. Flag for correction. |
| Fun Money allocation | OPEN (planned) | Kevin | No | $25,000 "Fun Money" (not contractually defined) — `is_non_revenue`, planned to move to the Fun Money Tracker. |
| STL-FL MiLB Snack price missing | OPEN (minor) | Kevin | No | Snack projection price blank in the SC — reconcile (flat-fee, so $0 anyway, but the service row is incomplete). |

## 6. HISTORY (superseded facts — MARKED, never deleted)
- **Installment 1 (K300168340, Nov 2025)** was billed WITH ~$24.5K sales tax — later credited back (the SF is non-taxable). The credit flowed through installments 3-4. `[§W, §X]`
- **$2.3M Total Annual Fee composition**: $1.4M Florida Services (revenue fee) + $900K passthrough + $30K upkeep. Only the $1.4M is the recognized SF. `[digest §B.3]`

## 7. PROVENANCE & ATTRIBUTION KEY (for this file)
- **Contract facts**: `../CONTRACT_DIGEST_STL-FL.md` (the Amendment, verbatim) + `../CONTRACT_DIGEST_STL-MO.md` (the base agreement it amends).
- **2026 fee + quarterly cadence + accrual + the credit-note trail**: finance schedule (§W).
- **SF non-taxable + the $24,500 credit**: invoice K300168343 (evidence §3.1) + Kevin (§U, §X).
- **Stakeholders (Kochan/Goldstein/Brauer) + upkeep-passthrough resolution + full-passthrough confirmation**: Kevin, 2026-07-16.
- **Money shape**: `../../SC_MONEY_MODEL.md` (flat_fee, fee-no-dollar variant).
- **Rulings**: `../LEDGER.md` §U (A-6 SF non-taxable), §W (fee), §X (credit).
- **Last reviewed**: 2026-07-16 by Kevin + Chat-Claude (Batch 2).

---
*Completeness: FULLY-CAPTURED (SF layer). Flat-fee. Amendment banked; $1.4M Florida Services Fee finance+invoice-confirmed; SF non-taxable (with the first-installment tax-then-credit story fully explained); quarterly cadence; 2027 work-stoppage lock-in captured; the $24,500 credit mechanic understood. Upkeep-ownership RESOLVED (Cardinals-reimbursed passthrough); full food/snack/beverage stream confirmed as reimbursable passthrough. One honest gap: the passthrough reimbursable invoices weren't sampled (structure mirrors STL-MO). SF non-taxable (Cardinals' legal position; they bear liability risk). Non-blocking opens: Fun Money.*
