# BILLING TERMS MATRIX — Contract vs Invoice vs P&L (per account)

> Bill-export cadence spec. **Contracts hold cadence authority** (per Kevin's Interpretation Guard 2026-07-14). P&L period allocation = revenue-RECOGNITION view only; where the P&L spread differs from contract-stated cadence, it's classified **"expected (recognition vs billing)"** — NOT a conflict.
>
> Cross-references: EVIDENCE_&lt;ACCOUNT&gt;.md §8 (billing cadence) + §9 (QB artifacts) + PL_2026_APPENDIX.md + CONFLICT_REGISTER.md.

---

## Matrix

Columns:
1. **Contract-stated billing terms** (verbatim from EVIDENCE §2 / re-verified against contract)
2. **Invoice-observed practice** (from 9-invoice CEO sample, EVIDENCE §3)
3. **P&L recognition spread** (from PL_2026_APPENDIX §3)
4. **Delta classification** — `expected` (recognition-vs-billing difference per Kevin's guard) OR `FLAG` (real conflict, cite CONFLICT_REGISTER entry)

---

### CIN - AZ (SF% 30% hybrid)

**Contract cadence**: SF 75% Feb 1 + 25% Mar 15 each year (§ IV.A.1 p.6). Catering fees invoiced "every fifteen (15) days ... arrears ... in detail sufficient for a proper pre- and post-audit", Net 30 (§ V.B + V.C p.7).

**Invoice cadence**: bi-weekly per-meal invoicing (K300168587 covers 3/9-3/22 = 14 days; K300168736 covers 5/4-5/16 = 13 days), Net 30. **SF invoices not in sample.**

**P&L recognition**: 2300 = $445,716/yr spread P1-P11 season-weighted (heavier P1-P2 spring, plateau P3-P9, decline P10-P11). 2400.1 = $1,074,983/yr similar season pattern. 2200 = $52,000/yr with only P1 + P2 populated at $3,000 each on the row (P13 or Year-column formula pulls the delta).

**Delta**: 2300 P&L spread across 11 periods vs contract SF billed Feb 1 / Mar 15 → **expected** (recognition spreads the season-earned SF across service months). Per-meal recognition matches invoice cadence (both bi-weekly). No flag.

### CIN - KY (No-SF per-meal, AAA)

**Contract cadence**: weekly per-meal, "billed weekly based on meals ordered for the prior week" (§ 4)a) p.2). Net terms not stated in executed 2026 contract.

**Invoice cadence**: no CIN-KY invoice in 9-invoice sample.

**P&L recognition**: 2400.1 = $180,237/yr, spread P3-P9 season pattern.

**Delta**: no invoice-side data; P&L recognition consistent with per-meal season pattern → **expected** on cadence gap. Net-terms remain UNKNOWN in the executed contract (chase item for Kevin).

### CIN - OH (Flat_fee $362,500 base, MLB)

**Contract cadence**: 2025 = 7 installments ($56,250 × 6 Mar-Aug + $20,000 Jan 2027). 2026+ = "six consecutive and equal monthly installments due on the first (1st) day of the month beginning on March 1st and ending August 1st" (§ 2.a p.2). Reimbursements for food/supplies + Clubhouse Extras "after each homestand ... 30 day terms" (§ 2.d p.2).

**Invoice cadence**: no CIN-OH invoice in sample.

**P&L recognition**: 2400.1 = $376,688/yr (contract $362,500 × ~3.9% CPI-U Aug-to-Aug per § 2.a p.2). Spread P3-P9 season pattern. 2300 = $0 (classification difference — flat fee booked as meal-service in P&L). No 2200.

**Delta**: 6 monthly SF invoices vs P&L 7-period recognition (P3-P9) → **expected** (monthly cash timing ≠ season revenue recognition). Reimbursement invoices per-homestand not in sample.

Cross-check: A-8 flags the P&L booking flat SF in 2400.1 rather than 2300 (MONEY_MODEL §e says 2300 = SF).

### STL - FL (Flat_fee $1,400,000 Florida Services, PDCO)

**Contract cadence**: Florida Services fee **quarterly Nov 1, Feb 1, May 1, Aug 1** (§ 2.a.i p.1). Food passthrough bi-monthly with receipts (§ 2.a.ii p.1-2). Upkeep budgets annual (§ 2.b p.2). 2027 first-quarter installment ($350K) "deemed earned in full" on Nov 1, 2026 (§ 2.c.ii p.2).

**Invoice cadence**: **K300168343** confirms quarterly billing — dated 07/01/2026, due 08/01/2026, "Service Fees (PFS)" line "2026 Service Fee - 4 of 4 (Final)" @ $350,000. Prior partial payment $24,500 applied → balance $325,500. **Aug 1 installment invoiced 30 days in advance** — matches contract § 2.a.i and contract-standard "invoice 30 days in advance of due date" (verified in TXR-TX-H § 2.a p.2; STL-FL contract silent on Net-N, but observed practice is 30 days).

**P&L recognition** (finance-source verified `PFS Service Fees 2026.xlsx` 2026-07-17): 2400.1 = $1,400,000/yr spread P1-P12 (P1 $45,553 · P2 $171,367 · P3 $407,375 (peak) · P4 $132,755 · P5-P9 each $98,915 · P10 $57,267 · P11 $52,061 · P12 $39,047 · P13 $0). 2300 = $0.

**Delta**: 4 quarterly invoices vs P&L 12-period recognition → **expected**. Recognition follows spring training peak → FCL plateau → offseason. Cash timing (quarterly) is decoupled from recognition (season-weighted). No flag on cadence.

Cross-check: A-6 (invoice tax = $0 vs contract § 2.d "subject to local sales tax"), A-9 (P&L numbers contradict GOTCHAS' P1/P3 claim).

### STL - MO (Flat_fee $473K, MLB)

**Contract cadence**: Meal services $423K in 6 monthly installments beginning March 1 (§ 2.a.i p.2). Road Food $50K annual March 1 (§ 2.a.ii p.2). Food passthrough monthly budget tracking (§ 2.a.iii p.2), no specific invoice cadence stated.

**Invoice cadence**: no STL-MO invoice in sample.

**P&L recognition**: 2400.1 = $439,431/yr (=$423K × CPI-escalated per § 2.d.i); spread P3-P9 season. 2300 (Road Catering) = $50,000/yr spread P3-P9 evenly ($7,143 × 7 periods ≈ $50K). No 2200.

**Delta**: 6 monthly SF invoices + 1 annual Road Food March 1 vs P&L 7-period recognition → **expected** (billing on separate cadence from recognition).

Cross-check: A-8 (meal-services $423K SF booked in 2400.1 not 2300).

### TBJ - FL (Flat SF $452,812 + per-meal parallel, PDCO)

**Contract cadence**: Per-meal weekly (§ 12(e) p.31, "Within five (5) days following the final day of each Calendar Week ... the Provider will deliver to the Club an invoice"). Pantry Items reimbursement weekly (§ 5(d) p.23). **Service Fee: contract SILENT on cadence** — "annual service fee ... for each SOW #1 Agreement Year during the Term" (§ 12(a) p.30) with no billing schedule stated. Net-N: "does not guarantee payment in less than thirty (30) calendar days from receipt of the invoice" (§ 14 p.32) = practical Net-30.

**Invoice cadence**: **K300168548 + K300168872** confirm weekly per-meal invoicing (Feb 23-Mar 1; Jun 29-Jul 5). Net 30. **SF invoices not in sample.**

**P&L recognition**: 2300 = $515,712/yr spread across P1-P12 (P1 $76,755 · P2 $117,894 · P3 $43,840 · P4-P11 declining · P12 $5,265 · P13 $0). 2400.1 = $1,381,253/yr similar shape.

**Delta**: contract silent on SF cadence — practical billing rhythm UNKNOWN; MONEY_MODEL §d cites "monthly Jan/Feb/Mar per ABR OneSheeter" but that's NOT in the contract (see A-3). P&L recognition is season-weighted, NOT concentrated in Jan/Feb/Mar → **expected** under Kevin's guard (recognition ≠ billing); however, the ABR OneSheeter claim itself is a **FLAG** (already A-3) because it's not contract-supported and the P&L spread contradicts it as a recognition proxy.

### TBJ - NY (No-SF per-meal, AAA — ASSUMPTION only)

**Contract cadence**: **NO CONTRACT ON FILE.** UNKNOWN cadence.

**Invoice cadence**: no TBJ-NY invoice in sample.

**P&L recognition**: 2400.1 = $155,018/yr, spread P3-P9 season pattern. 2300 = $0.

**Delta**: **FLAG** (paperwork gap Q6 in MONEY_MODEL, confirmed in this pass). Cannot classify delta without contract. Chase: obtain contract or written confirmation before finalizing 2026 billing cadence.

### TBR - FL (MLB per-meal + MiLB SF% 25% one-time 2024, PDCO)

**Contract cadence**: per-meal weekly for both MLB and MiLB (MLB SOW § 6(ii) p.5; MiLB SOW § 6(b) p.5-6). MiLB SF $382,448 = **two 2024 installments** only (§ 6(c) p.6). CPI-U Food Away from Home Nov-to-Nov applies to per-meal rates only.

**Invoice cadence**: **K300168545 + K300168871** confirm weekly per-meal. Net 30. SF invoices not in sample.

**P&L recognition**: 2300 = **$457,768/yr** (peak P2, plateau P3-P8, decline P9-P11). 2400.1 = $1,752,424/yr. 2200 = $79,950/yr spread across the season.

**Delta**: **FLAG (C-2)** — P&L 2300 shows $457,768 for 2026 despite contract stipulating $382,448 as a 2024 one-time payment with no 2025+ renewal clause. Either the P&L reflects a NEW 2026 SF billing (not yet contract-documented) or a large recognition spread of the 2024 amortization + upward CPI + rounding. Cannot conclude billing-vs-recognition per Kevin's ruling — evidence only. Delta = +$75,320 above 2024 base = 19.7%.

### TXR - AZ (Per-meal with 20% deposit-triggered discount, PDC)

**Contract cadence**: Annual Deposit **3 equal installments January 1, February 1, March 1** (§ 2.b p.1). Per-meal weekly (Monday-Sunday), Net 30 (§ 3 p.1-2).

**Invoice cadence**: **K300168585 + K300168870** confirm weekly per-meal, Net 30. Deposit invoices not in sample.

**P&L recognition**: 2300 = $301,621/yr spread season-weighted (peak P2, decline through P11). 2400.1 = $1,206,484/yr. 2200 = $0.

**Delta**: deposit billed in 3 equal Jan/Feb/Mar installments vs P&L 11-period recognition → **expected** (deposit is applied against actuals via the post-deposit rate mechanic; recognition follows service months).

### TXR - TX - H (Flat_fee $604,032, MLB, single-season 2026)

**Contract cadence**: 6 monthly installments Apr 1 - Sep 1, 2026, each $100,672 pre-tax / $108,977.44 with sales tax. "Contractor agrees to invoice the Rangers thirty (30) days in advance of each due date" (§ 2.a p.2).

**Invoice cadence**: no TXR-TX-H invoice in sample. Expected pattern per contract: 6 SF invoices Mar 1 - Aug 1 (30 days in advance), Net implicit 30 (due dates are the 1st of the month).

**P&L recognition**: 2400.1 = $604,019/yr, spread P3-P9 season pattern (matches MONEY_MODEL fee $604,032). 2300 = $0.

**Delta**: 6 monthly SF invoices vs P&L 7-period recognition → **expected**.

Cross-check: A-8 (flat SF booked in 2400.1 not 2300); C-4 (missing § 2(d) kitchen setup budget).

### TXR - TX - V (Flat_fee $0 covered by H)

**Contract cadence**: no separate contract — bundled inside TXR-TX-H. Contract § 1.b p.1 limits visitor scope to "Grab & Go Snack options ... packaged snacks, condiments, and beverages; and coffee service."

**Invoice cadence**: no TXR-TX-V invoice in sample. Direct-sales revenue tracked in Season Tracker (per MONEY_MODEL §g).

**P&L recognition**: **2400.1 = $312,000/yr** spread P3-P9 season (matches game count × ~$3,852/game). 2300 = $0. 2200 = $0.

**Delta**: **FLAG (A-14)** — MONEY_MODEL treats TXR-TX-V as $0 covered-by-H; P&L books $312K in 2400.1. Kevin rules whether this direct-sales revenue should flow through the SC (currently out-of-scope per MONEY_MODEL §g) or stay in Season Tracker with a P&L-only recognition.

---

## Summary

- **6 accounts** with clean cadence tie-out (contract ↔ invoice ↔ P&L): CIN-AZ, CIN-KY, STL-MO, TXR-AZ, TXR-TX-H, plus STL-FL (with A-6 tax flag). All deltas classified `expected`.
- **1 account** with FLAG-worthy contract-recognition delta: **TBR-FL C-2** — P&L 2300 shows $457K/yr; contract silent on 2026 SF. Kevin rules.
- **1 account** with FLAG-worthy classification: **TBJ-FL A-3** — contract silent on SF cadence; MONEY_MODEL claim of Jan/Feb/Mar concentration not supported by contract or P&L.
- **1 account** with FLAG-worthy classification: **TXR-TX-V A-14** — P&L books $312K but MONEY_MODEL treats as $0 covered-by-H (Season Tracker direct sales).
- **1 account** with PAPERWORK GAP: **TBJ-NY** — no contract on file.
- **1 systemic FLAG**: **A-8** — 4 flat-fee accounts (CIN-OH, STL-FL, STL-MO meal-services portion, TXR-TX-H) book SF in 2400.1 not 2300, contradicting MONEY_MODEL §e mapping.

All contract-vs-invoice-vs-P&L cadence deltas that aren't in the FLAG list above are classified **"expected (recognition vs billing)"** per Kevin's Interpretation Guard.
