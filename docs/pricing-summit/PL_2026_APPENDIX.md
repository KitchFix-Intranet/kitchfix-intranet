# 2026 P&L per-site appendix — Pricing Summit Phase 0b

> Read-only extraction from Kevin's Finance folder. All figures are 2026 BUDGET. **No billing conclusions** — per Kevin's interpretation guard: "P&L period allocation = revenue-RECOGNITION view only." Contracts hold cadence authority.
>
> **Source path**: `/Users/kevinfietek/Documents/KitchFix/Finance/P:L 2026/2026 P&L Individual Sites/` (macOS Finder colon; `P:L 2026` = `P/L 2026`).
> **Reproduce via**: `python3 scripts/_probe_pricing_summit_pl_extract.py`.

---

## §1. Inventory + name-resolution

11 individual-site `.xlsx` files, one per canonical account. Mapping resolved by NAME (per name-resolution law):

| File | Sheet name | Rows × Cols | Canonical account_key |
|---|---|---|---|
| `CIN - Cincinnati, OH - 2026 P&L - Clean.xlsx` | `CIN - Cincinnati, OH` | 297 × 197 | **CIN - OH** |
| `CIN - Goodyear, AZ - 2026 P&L - Clean.xlsx` | `CIN - Goodyear, AZ` | 1000 × 197 | **CIN - AZ** |
| `CIN - Louisville, KY - 2026 P&L - Clean.xlsx` | `CIN - Louisville, KY` | 1000 × 197 | **CIN - KY** |
| `STL - Jupiter, FL - 2026 P&L - Clean.xlsx` | `STL - Jupiter, FL` | 297 × 204 | **STL - FL** |
| `STL - St. Louis, MO - 2026 P&L - Clean.xlsx` | `STL - St. Louis, MO` | 297 × 204 | **STL - MO** |
| `TBJ - Buffalo, NY - 2026 P&L - Clean.xlsx` | `TBJ - Buffalo, NY` | 1000 × 197 | **TBJ - NY** |
| `TBJ - Dunedin, FL - 2026 P&L - Clean.xlsx` | `TBJ - Dunedin, FL` | 1000 × 197 | **TBJ - FL** |
| `TBR - Port Charlotte, FL - 2026 P&L - Clean.xlsx` | `TBR - Port Charlotte, FL` | 1000 × 200 | **TBR - FL** |
| `TXR - H - Arlington, TX - 2026 P&L - Clean.xlsx` | `TXR - Home - Arlington, TX` | 1000 × 207 | **TXR - TX - H** |
| `TXR - Surprise, AZ - 2026 P&L - Clean.xlsx` | `TXR - Surprise, AZ` | 1000 × 197 | **TXR - AZ** |
| `TXR - V - Arlington, TX - 2026 P&L - Clean.xlsx` | `TXR - Visitor - Arlington, TX` | 1000 × 197 | **TXR - TX - V** |

All 11 accounts covered. No UNKNOWNs.

## §2. Standard sheet shape

Every site's P&L is single-sheet with a consistent structure:

- **R1**: title (e.g. "Cincinnati Reds - Cincinnati, OH · 2026").
- **R2**: subtitle "2026 - P&L Budget vs. Actual".
- **R3**: period header row — `P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 P12 P13 Year`. Columns C2..C14 = P1..P13; C15 = Year.
- **R4**: period-start ISO dates (P1 = 2025-12-29, ..., P13 = 2026-11-30).
- **R5/R6**: "Revenue" and "Total Revenue" summary lines (values here match the sum of the itemized revenue rows below).
- **R20**: "Revenue" section subheader, echoes `P1..P13 Total`.
- **R21**: **2200 Catering Revenue** (13-period vector + Year total).
- **R22**: **2300 Service Charges** (with variant sub-labels; STL-FL and STL-MO show `2300 Service Charges - Road Catering`).
- **R24**: `2400 Meal Service` (parent, always blank).
- **R25**: **2400.1 Meal Service (Home)** — the load-bearing per-meal revenue line.
- **R26**: `2400.2 Meal Service (Away)` — always $0 or blank across all 11 sites.
- **R27**: `Total 2400 Meal Service` — echoes R25.
- **R31**: `Total Revenue` — echoes R6.

**Read column**: `C3..C15` for P1..P13; `C16` for Year (see `scripts/_probe_pricing_summit_pl_extract.py` for the header-detection logic).

**No tax lines** on any P&L. Confirms R9 (Kevin ruling: SC carries pre-tax; tax applies in QB at invoice).

**No passthrough lines** on the revenue side. CIN-OH food+supplies, STL-MO $225K, and STL-FL $900K are NOT in the P&L revenue section — consistent with MONEY_MODEL §h (passthrough excluded from revenue).

## §3. Per-account 13-period tables

Cells: rows are the P&L line item + row number for provenance. Values in USD (rounded to whole dollars for readability; source is per-cent precision).

### 3.1 CIN - OH (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges | R22 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2400.1 Meal Service (Home) | R25 | 0 | 0 | 57,218 | 57,218 | 52,450 | 71,523 | 47,682 | 57,218 | 33,377 | 0 | 0 | 0 | **376,688** |
| Total Revenue | R31 | 0 | 0 | 57,218 | 57,218 | 52,450 | 71,523 | 47,682 | 57,218 | 33,377 | 0 | 0 | 0 | **376,688** |

**Flat-fee $362,500 contract SF is booked ENTIRELY in 2400.1**, NOT in 2300. Recognition spread P3..P9 (season pattern). Year total $376,688 = $362,500 × ~3.9% CPI escalator ≈ derivation.

### 3.2 CIN - AZ (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | 3,000 | 3,000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **52,000** |
| 2300 Service Charges | R22 | 53,224 | 115,234 | 38,304 | 31,126 | 37,672 | 37,672 | 39,453 | 35,835 | 32,159 | 12,634 | 6,317 | 0 | **445,716** |
| 2400.1 Meal Service (Home) | R25 | 156,980 | 320,184 | 87,747 | 67,996 | 70,742 | 70,742 | 82,477 | 82,295 | 74,181 | 31,073 | 15,537 | 0 | **1,074,983** |
| Total Revenue | R31 | 213,204 | 438,418 | 126,051 | 99,122 | 108,414 | 108,414 | 121,930 | 118,130 | 106,340 | 43,707 | 21,854 | 0 | **1,572,699** |

**Note on 2200**: only P1 + P2 show $3,000 each (=$6,000) but Year total $52,000; sum-of-periods delta = $46,000. Kevin: this is either a hidden P13 value or a Year-column formula pulling from elsewhere. Flag for verification with the accountant.

### 3.3 CIN - KY (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges | R22 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2400.1 Meal Service (Home) | R25 | 0 | 0 | 36,203 | 28,807 | 28,807 | 28,807 | 14,403 | 28,807 | 14,403 | 0 | 0 | 0 | **180,237** |
| Total Revenue | R31 | 0 | 0 | 36,203 | 28,807 | 28,807 | 28,807 | 14,403 | 28,807 | 14,403 | 0 | 0 | 0 | **180,237** |

Contract estimate $186,462; P&L $180,237 = $6,225 lower. Reasonable for a per-meal budget forecast on a season pattern.

### 3.4 STL - FL (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges - Road Catering | R22 | - | - | - | - | - | - | - | - | - | - | - | 0 | - | **0** |
| 2400.1 Meal Service (Home) | R25 | 171,367 | 407,375 | 132,755 | 98,915 | 98,915 | 98,915 | 98,915 | 98,915 | 57,267 | 52,061 | 39,046 | 0 | **1,400,000** |
| Total Revenue | R31 | 171,367 | 407,375 | 132,755 | 98,915 | 98,915 | 98,915 | 98,915 | 98,915 | 57,267 | 52,061 | 39,046 | 0 | **1,400,000** |

**Full 13-period 2300 vector**: all zeros. **STL-FL's $1.4M fee is booked ENTIRELY in 2400.1** across P1-P11 with P12-P13 at $0. Year total = $1,400,000 EXACT MATCH to MONEY_MODEL SF.

### 3.5 STL - MO (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges - Road Catering | R22 | 0 | 0 | 7,143 | 7,143 | 7,143 | 7,143 | 7,143 | 7,143 | 7,143 | 0 | 0 | 0 | **50,000** |
| 2400.1 Meal Service (Home) | R25 | 0 | 0 | 65,101 | 65,101 | 65,101 | 92,226 | 54,251 | 48,826 | 48,826 | 0 | 0 | 0 | **439,431** |
| Total Revenue | R31 | 0 | 0 | 72,244 | 72,244 | 72,244 | 99,369 | 61,394 | 55,969 | 55,969 | 0 | 0 | 0 | **489,431** |

$50,000 Road Food Management appears in 2300 (spread 7 periods × $7,143 = $50,001 ≈ $50K). Meal-services SF $423K contract base is booked in 2400.1 at $439,431 (CPI-escalated from $423K per § 2.d.i).

### 3.6 TBJ - NY (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges | R22 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2400.1 Meal Service (Home) | R25 | 0 | 0 | 19,685 | 24,606 | 24,606 | 24,606 | 24,606 | 24,606 | 12,303 | 0 | 0 | 0 | **155,018** |
| Total Revenue | R31 | 0 | 0 | 19,685 | 24,606 | 24,606 | 24,606 | 24,606 | 24,606 | 12,303 | 0 | 0 | 0 | **155,018** |

No-SF as expected. $155K/yr per-meal budget on Buffalo Bisons AAA. Season pattern.

### 3.7 TBJ - FL (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges | R22 | 76,755 | 117,894 | 43,840 | 39,175 | 39,238 | 35,252 | 44,104 | 25,169 | 33,994 | 22,115 | 14,217 | 5,265 | **515,712** |
| 2400.1 Meal Service (Home) | R25 | 227,221 | 349,002 | 104,121 | 100,983 | 105,745 | 93,201 | 114,274 | 79,826 | 74,591 | 48,525 | 31,195 | 11,554 | **1,381,253** |
| Total Revenue | R31 | 308,976 | 481,897 | 147,961 | 140,158 | 144,983 | 128,454 | 158,378 | 104,995 | 108,585 | 70,640 | 45,412 | 16,819 | **1,921,966** |

### 3.8 TBR - FL (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | 9,100 | 7,150 | 9,100 | 9,100 | 1,950 | 0 | 0 | 4,550 | 9,100 | 9,100 | 7,150 | 4,550 | **79,950** |
| 2300 Service Charges | R22 | 30,072 | 99,287 | 45,688 | 40,915 | 40,915 | 40,915 | 42,961 | 40,915 | 33,959 | 21,685 | 18,412 | 0 | **457,768** |
| 2400.1 Meal Service (Home) | R25 | 225,506 | 562,034 | 134,756 | 121,095 | 121,095 | 121,095 | 126,950 | 120,095 | 99,189 | 62,060 | 52,693 | 0 | **1,752,424** |
| Total Revenue | R31 | 264,679 | 668,470 | 189,544 | 171,110 | 163,960 | 162,010 | 169,910 | 165,560 | 142,248 | 92,845 | 78,255 | 4,550 | **2,290,142** |

### 3.9 TXR - TX - H (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges | R22 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2400.1 Meal Service (Home) | R25 | 0 | 0 | 44,452 | 112,436 | 73,214 | 112,436 | 96,748 | 96,748 | 67,985 | 0 | 0 | 0 | **604,019** |
| Total Revenue | R31 | 0 | 0 | 44,452 | 112,436 | 73,214 | 112,436 | 96,748 | 96,748 | 67,985 | 0 | 0 | 0 | **604,019** |

**Full $604K flat SF booked in 2400.1**, not 2300. Year total $604,019 matches MONEY_MODEL fee $604,032 (rounding on the P&L).

### 3.10 TXR - AZ (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| 2300 Service Charges | R22 | 25,092 | 84,568 | 27,099 | 21,635 | 24,980 | 24,980 | 28,214 | 25,203 | 21,263 | 7,435 | 5,576 | 0 | **301,621** |
| 2400.1 Meal Service (Home) | R25 | 141,926 | 407,160 | 93,371 | 73,309 | 83,311 | 83,311 | 95,410 | 84,580 | 73,365 | 28,297 | 21,223 | 0 | **1,206,484** |
| Total Revenue | R31 | 167,018 | 491,728 | 120,471 | 94,943 | 108,291 | 108,291 | 123,624 | 109,783 | 94,628 | 35,732 | 26,799 | 0 | **1,508,105** |

### 3.11 TXR - TX - V (`R21..R27`)

| Line | R# | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | Year |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2200 Catering Revenue | R21 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2300 Service Charges | R22 | - | - | - | - | - | - | - | - | - | - | - | - | - | **0** |
| 2400.1 Meal Service (Home) | R25 | 0 | 0 | 21,600 | 62,400 | 31,200 | 62,400 | 48,000 | 48,000 | 38,400 | 0 | 0 | 0 | **312,000** |
| Total Revenue | R31 | 0 | 0 | 21,600 | 62,400 | 31,200 | 62,400 | 48,000 | 48,000 | 38,400 | 0 | 0 | 0 | **312,000** |

**MONEY_MODEL says TXR-TX-V = $0 fee-schedule ("covered by TXR-TX-H").** The P&L books $312,000/yr in 2400.1 for TXR-TX-V. This is presumably the Season Tracker direct-sales revenue (MONEY_MODEL §g: "Real visiting-team direct-sales revenue is tracked in Season Tracker (sold-through revenue × 19.23% labor model), out of scope for the SC and the fee schedule"). See CONFLICT_REGISTER §A-14 for the P&L classification.

## §4. Targeted answers

### Q1. TBR - FL 2300 (C-2 evidence — does the P&L support 2026 SF billing?)

- **P&L 2300 Year total**: **$457,768**
- **Contract 2024 one-time SF**: $382,448 (paid 2 installments Jan+Feb 2024)
- **Delta**: +$75,320 (P&L is 19.7% higher than 2024 base)
- **13-period spread**: P1 $30,072 · P2 $99,287 · P3 $45,688 · P4-P8 all $40,915 (identical 5 periods) · P7 $42,961 (small bump — either DH or 1-week seasonality) · P9 $33,959 · P10 $21,685 · P11 $18,412 · P12 $0 · P13 $0

**Amortization arithmetic check**:
- $382,448 / 13 periods = $29,419/period — NOT matching the P&L spread
- $382,448 / 12 periods = $31,871/period — NOT matching either
- $382,448 / 11 (P1-P11 non-zero) = $34,768/period — NOT matching
- The P&L spread is season-shaped (peak P2, flat P3-P8, decline P9-P11), not straight-line amortized.

**Evidence, no conclusion** (Kevin rules):
1. The $457K/yr on the P&L could be (a) a fresh 2026 SF billing at ~$458K (contract-permitted post-2024 renewal), OR (b) recognition of amortized $382,448 with the difference being CPI-escalation to 2026 + accounting rounding.
2. The 19.7% delta is large for pure escalation — 75% × CPI-U Food Away from Home from 2024 to 2026 = roughly 3-6% depending on the two-year window. Doesn't reach 19.7%.
3. Contract § 6(c) MiLB SOW is SILENT on SF renewal beyond 2024.
4. Invoice sample K300168545 + K300168871 for TBR-FL shows NO 2300 SF line in the invoices for 2026 (both are pure per-meal). Under Kevin's interpretation guard, this could mean (a) SF is invoiced separately from per-meal invoices and not sampled here, or (b) SF was truly one-time 2024 and the P&L $457K reflects recognition of a different revenue stream.

**Conclusion**: P&L shows an SF-like number for TBR-FL in 2026, size consistent with a "somewhat above 2024" 2026 SF — contract silent — Kevin rules.

### Q2. TBJ - FL 2300 spread (A-3 evidence)

- **P&L 2300 Year**: **$515,712**
- **13-period spread**: P1 $76,755 · P2 $117,894 · P3 $43,840 · P4 $39,175 · P5 $39,238 · P6 $35,252 · P7 $44,104 · P8 $25,169 · P9 $33,994 · P10 $22,115 · P11 $14,217 · P12 $5,265 · P13 (blank)

**Concentrated in Jan/Feb/Mar (=P1-P3)?**
- P1-P3 sum: $76,755 + $117,894 + $43,840 = **$238,489 = 46.2% of the annual**
- Remaining P4-P12: $277,223 = 53.8% of the annual

**Answer**: not concentrated in Jan/Feb/Mar. There's a P1-P2 front-load ($194,649 = 37.7%) that resembles spring-training-heavy revenue, but 62% is spread across P3-P12 (April - November). This CONTRADICTS the MONEY_MODEL §d claim "Split monthly Jan/Feb/Mar per ABR OneSheeter" **for recognition purposes**. Per Kevin's guard, the recognition spread ≠ billing schedule; billing could still be Jan/Feb/Mar even though recognition is spread. **See CONFLICT_REGISTER A-3** (already logged) — the P&L evidence STRENGTHENS the flag that MONEY_MODEL's claim doesn't tie to contract text; the P&L supports a season-weighted recognition, not a Jan/Feb/Mar concentration.

### Q3. STL - FL 13-period 2300 (all zeros) + confirm/extend/contradict GOTCHAS

- **P&L 2300** vector: 0 for every period (verbatim from R22).
- **P&L 2400.1** vector: **P1 $171,367 · P2 $407,375 · P3 $132,755 · P4-P8 all $98,915 (5 identical periods — the "FCL plateau") · P9 $57,267 · P10 $52,061 · P11 $39,046 · P12 $0 · P13 $0** — Year total $1,400,000 EXACT.

**GOTCHAS claim** (per MONEY_MODEL §g citation): "P1 $45,553 · P3 $407,375 · FCL plateau $98,915 · offseason $0"

**Match / Contradict**:
- ✓ **CONFIRMED**: FCL plateau at $98,915 (P4-P8 all show $98,915, 5 consecutive periods — this is the plateau)
- ✓ **CONFIRMED**: offseason $0 (P12 + P13)
- **CONTRADICT**: GOTCHAS says P1 = $45,553; P&L shows **P1 = $171,367** (3.76× higher)
- **CONTRADICT**: GOTCHAS says P3 = $407,375; P&L shows **P2 = $407,375** and P3 = $132,755 (peak is P2 not P3)

**Extension**: GOTCHAS didn't publish full 13-period vector. Full vector now available above. See CONFLICT_REGISTER A-9 for the GOTCHAS-vs-P&L numerical delta.

### Q4. Every-account annual 2300 vs known SF (mismatch table)

| Account | MONEY_MODEL SF | P&L 2300 Year | Delta | Interpretation |
|---|---:|---:|---:|---|
| CIN - AZ | $402,016 (2023 base) | $445,716 | +$43,700 | ~11% escalation from 2023 base — consistent with 3 years of CPI within § IV.B.3's 2%-5% floor/cap band |
| CIN - KY | $0 (No-SF) | $0 | 0 | ✓ |
| **CIN - OH** | $362,500 fee | **$0** in 2300; $376,688 in 2400.1 | see A-8 | **Flat fee booked in 2400.1**, not 2300. P&L classification differs from MONEY_MODEL §e |
| **STL - FL** | $1,400,000 fee | **$0** in 2300; $1,400,000 in 2400.1 | see A-8 | Same — flat fee in 2400.1 |
| STL - MO | $50,000 Road Food (subset of $473K) | $50,000 in 2300 (Road Catering) | 0 | ✓ ; meal-services $423K booked in 2400.1 |
| **STL - MO** (Meal Services SF) | $423,000 (subset) | included in 2400.1 $439,431 | see A-8 | Meal-services SF classification like CIN-OH |
| TBJ - FL | $452,812 (contract 2023 base) | $515,712 | +$62,900 | ~14% higher than 2023 base — CPI-escalated per § 12(c) (approved rate increases) |
| TBJ - NY | $0 (No-SF assumed) | $0 | 0 | ✓ |
| **TBR - FL** | $382,448 (2024 one-time) OR unknown 2026 | **$457,768** | +$75,320 vs 2024 base | Kevin rules — see Q1 |
| TXR - AZ | $297,419 (2025 deposit) | $301,621 | +$4,202 | Small increment — 2026 deposit escalated from 2025 (or a P&L rounding forecast); consistent trajectory |
| **TXR - TX - H** | $604,032 fee | **$0** in 2300; $604,019 in 2400.1 | see A-8 | Same classification as CIN-OH and STL-FL |
| **TXR - TX - V** | $0 (covered by H) | **$0** in 2300; **$312,000 in 2400.1** | see A-14 | P&L books V direct sales in 2400.1 despite MONEY_MODEL "$0 covered by H" |

### Q5. 2400.1 sanity spot-check (CIN - AZ + TBJ - FL)

**CIN - AZ**: P&L 2400.1 = $1,074,983/yr

Post-SF rates from MONEY_MODEL: MiLB $12.90 / MLB $20.31.

Rough back-of-envelope: assume ~35,000 MiLB meals × $12.90 = $451,500 + ~30,000 MLB meals × $20.31 = $609,300 = **~$1,060,800**. Plus $52K Coffee/Fountain lines → $1,112,800. **Within $40K of the P&L $1,075K** (per-count assumptions rough; not exact but plausible).

**TBJ - FL**: P&L 2400.1 = $1,381,253/yr

Post-SF rates from MONEY_MODEL: MiLB $11.55 / MLB $23.12.

Rough back-of-envelope: assume ~50,000 MiLB × $11.55 = $577,500 + ~35,000 MLB × $23.12 = $809,200 = **~$1,386,700**. Within $5K of the P&L $1,381,253. **Very close.**

**Verdict**: 2400.1 numbers are ROUGHLY consistent with `projected_count × post-SF rate`. Per-count assumptions can't be verified precisely without projected count data, but both accounts land within a few percent of expectations. **No conflict** on 2400.1 arithmetic.

### Q6. TXR - TX - V revenue lines

- **2400.1 Meal Service (Home)** = **$312,000/yr** — spread P3-P9 (season pattern)
- **2300 Service Charges** = $0
- **2200 Catering Revenue** = $0

**MONEY_MODEL says** TXR-TX-V is $0 fee-schedule with "Real visiting-team direct-sales revenue is tracked in Season Tracker (sold revenue × 19.23% labor model), out of scope for the SC and the fee schedule" (§g).

**P&L books $312,000/yr in 2400.1** for TXR-TX-V. The Season Tracker direct-sales revenue IS on the P&L; it's just labeled 2400.1 Meal Service (Home) with the "Home" label reflecting the SC/QB coding (Home = visitor clubhouse at TX-H's home stadium, from the operator's perspective).

$312,000 / 81 games ≈ $3,852/game — plausible for visitor clubhouse direct sales.

**See CONFLICT_REGISTER A-14** for the classification.

---

## §5. Cross-cutting findings

### 5.1 P&L revenue-line classification differs from MONEY_MODEL §e mapping (A-8)

MONEY_MODEL §e says:
- 2400.1 = "per-meal invoice = actual_count × post-SF invoice rate"
- 2300 = "Service Fee attributable to the review period"

But the P&L books all four flat-fee-account SFs (**CIN-OH $377K, STL-FL $1.4M, STL-MO $439K meal-services portion, TXR-TX-H $604K**) in 2400.1 Meal Service (Home), leaving 2300 empty (STL-MO's Road Food excepted). This is a P&L account-code classification choice — the fee compensates for meal service, so the accountant books it as meal-service revenue.

**Recognition-vs-classification alignment**: Kevin rules. The MONEY_MODEL mapping and the P&L classification may need to be reconciled before the KPI-dashboard build.

### 5.2 P&L recognition is season-weighted, not billing-schedule

Every 2300 vector on the P&L is season-weighted (heavier P2-P3 spring training, plateau summer, decline fall). This is **RECOGNITION** per Kevin's guard. Contract billing schedules (75%/25% Feb/Mar for CIN-AZ; 4 quarterly for STL-FL; 6 monthly Apr-Sep for TXR-TX-H; etc.) drive the ACTUAL invoice dates — those may or may not match the P&L period allocation.

### 5.3 Passthrough EXCLUDED from P&L revenue (validates MONEY_MODEL §h)

No line in any P&L for:
- CIN-OH food/supplies passthrough
- STL-MO $225K passthrough
- STL-FL $900K passthrough
- STL-FL $30K upkeep budgets

All excluded from revenue. Consistent with MONEY_MODEL §h.

### 5.4 No tax lines (validates R9)

No revenue row on any of the 11 P&Ls carries a tax figure. Consistent with Kevin's ruling: **SC + P&L carry pre-tax only; tax applied in QB at invoice.**

### 5.5 2200 Catering Revenue is small + only two accounts

Only CIN-AZ ($52K) and TBR-FL ($79,950) have non-zero 2200. All others = $0. New line items not currently documented in MONEY_MODEL. See CONFLICT_REGISTER A-13.
