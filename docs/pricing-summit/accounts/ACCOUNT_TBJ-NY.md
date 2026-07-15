# ACCOUNT: TBJ-NY
> Canonical record. Current-state above the fold; history preserved below (§6). Primary key is the intranet account name. Reasoning/decisions journaled in `../LEDGER.md`; verbatim contract terms in `../CONTRACT_DIGEST_TBJ-NY.md`.
> ⚠️ **HIGHEST DOCUMENTATION RISK of the 11 accounts.** No operative contract on file. The billed rate is Joe-attested (signed sheet) + PG-matched — billing is covered — but the contract *justifying* it is absent. Read §5.

## 0. IDENTITY & ALIASES (the crosswalk — join everything on the primary key)
- **Primary key (intranet)**: `TBJ-NY`
- **Team / entity**: Buffalo Bisons — Toronto Blue Jays AAA affiliate, Sahlen Field (Buffalo, NY)
- **Level / tier**: AAA (MiLB)
- **Search aliases**: "Buffalo", "Buffalo Bisons", "Bisons", "Sahlen Field", "Blue Jays AAA", "Buffalo New York"
- **Crosswalk to other systems**:
  | System | How this account appears |
  |---|---|
  | Intranet (PRIMARY) | `TBJ-NY` |
  | PG `accounts` | team_key `TBJ - NY` · name "Buffalo Bisons" · level `AAA` · billing_model `actuals_drive_invoice` · has_homestand_schedule `true` · has_schedule_overlay `false` |
  | PG `sc_service_prices` | "Breakfast", "Lunch", "Post-Game", "Umpire" (all $27.34); "Snack", "Shake" (deactivated, $0) |
  | QuickBooks (invoice `Item`) | UNKNOWN — no TBJ-NY invoice in sample (accounting pulling copies) |
  | P&L file | Buffalo Bisons rows |
  | ABR OneSheeter tab | NOT included (the OneSheeter's "TORONTO BLUE JAYS" tab covers the relationship but Buffalo is treated as adjacent; ABR notes "How is Buffalo going?" as an open question) |
  | Contract folder | `/Contracts/TBJ NY/` (contained only a 2019 historical draft SOW — see §1/§6) |
- **Client stakeholders**: **[TBD — Kevin to provide]**. Michelle (prior TBJ relationship contact) **left the organization**; the current Buffalo contact is pending. `[src: Kevin, 2026-07-15]`
- **Capture completeness**: **THIN** — no operative contract. A single 2019 historical draft SOW exists (unsigned, superseded, rate $18.75 — not today's $27.34). The operative rate is Joe-attested via the signed sheet + PG-matched, so *billing-accuracy* is covered, but the *contractual justification* (the "why $27.34" paper) and a client countersignature are absent. This is a business-exposure gap, not a billing-accuracy gap.

## 1. CONTRACT (pointer, not duplication)
- **Operative doc**: **NONE ON FILE.** No 2020–2026 Buffalo SOW of any kind. The operative $27.34 rate has zero contemporary contract backing in the folder.
- **Only document present**: `2019.04.16_Buffalo_Catering_SOW_v1.0_w_3rdpartyvendor.docx.pdf` — a **2019 single-season SOW, UNSIGNED** (draft-review markup, "Note to Draft" comments, placeholder dates "April X, 2019"). HISTORICAL, never operative for 2026. `[digest §A]`
- **Verbatim source-of-record**: `../CONTRACT_DIGEST_TBJ-NY.md` (documents the 2019 draft verbatim + the gap precisely).
- **Governing master (NOT in folder)**: the 2019 SOW references a Master Services Agreement between **Rogers Blue Jays Baseball Partnership and CJK Foods LLC, dated December 11, 2018** — this MSA is **not in the folder**. All base terms (MFN, exclusivity, IP, indemnity) live there, unread.
- **Paperwork status**: **the critical gap.** Highest-priority chase: (1) the Dec 11, 2018 MSA, (2) a current-year Buffalo SOW or written rate confirmation. Owner: Kevin (business-side). Risk-accepted per Layer B (operative price is Joe-attested), but flagged explicitly + visibly.

## 2. BILLING RECORD (consumer: bill export / PG / finance)

### 2a. Money shape
- **Shape**: **Pure per-meal, NO service fee (assumption).** `actual_count × $27.34` = invoice. No SF, no passthrough — but this shape is *assumed* (mirrors CIN-KY, the sibling AAA account), NOT contract-confirmed, because there's no operative contract. `[MONEY_MODEL: No-SF assumption]`
- **Service Fee**: NONE (assumed; no contract to confirm).
- **Escalation regime**: **UNKNOWN** — no operative contract. The 2019 draft had no escalator (single-season). The $27.34 rate is **Kevin-confirmed correct** (2026-07-15), but how it was originally set and whether it escalates remain undocumented.
- **Tax treatment**: NY sales tax (assumed; the 2019 draft referenced NY food-service compliance and "plus applicable taxes"). SC emits pre-tax (R9); rate UNKNOWN, no invoice sample.

### 2b. Rate table (effective-dated; the retrievable price list)
> No SF, so sticker = billed rate. The rate is **assumption-only** — Joe-attested via the signed sheet + PG-matched, but with no operative contract behind it. All as-of 2026.

| Service | Billed rate | Unit | as-of | Source | PG match |
|---|---|---|---|---|---|
| Breakfast | **$27.34** | per meal | 2026 | signed sheet + **Kevin-confirmed 2026-07-15** | PG $27.34 ✓ |
| Lunch | $27.34 | per meal | 2026 | signed sheet | PG $27.34 ✓ |
| Post-Game | $27.34 | per meal | 2026 | signed sheet | PG $27.34 ✓ |
| Umpire | $27.34 | per meal | 2026 | signed sheet | PG $27.34 ✓ |
| Snack | — (deactivated) | — | 2026 | signed sheet | PG $0, inactive `[C-10 ruled: deactivate]` |
| Shake | — (deactivated) | — | 2026 | signed sheet | PG $0, inactive `[C-10 ruled: deactivate]` |

**Rate-table notes:**
- **The $27.34 rate is Kevin-CONFIRMED correct (2026-07-15)** — but it remains the least contractually-supported price of the 11. It's Joe-attested (signed Price Review v3), PG-matched (100%-match group), and now Kevin-confirmed — so the *number* is solid. What's still missing is the *contract* justifying it (business-exposure gap, not a billing-accuracy gap). The 2019 draft rate was $18.75 (not derivable to $27.34).
- **Snack + Shake are correctly DEACTIVATED** ($0/inactive) per the C-10 ruling — not missing prices, deliberately inactive. `[LEDGER §O, C-10; §U confirms]`

### 2c. Passthrough / non-revenue lines
- **NONE identified** (assumed; no contract). The `w_3rdpartyvendor` filename hint (§6) suggests a possible subcontractor arrangement — flag if PG ever references Buffalo third-party passthrough.

### 2d. Ancillary revenue (out of SC meal-model scope)
- **NONE identified.**

### 2e. Worked billing example (golden-test seed — to the penny)
- **NOT AVAILABLE** — no TBJ-NY invoice in the sample. Golden-test coverage pending an invoice sample `[Sebastian #3]`. When obtained: (meal count × $27.34) = pre-tax subtotal, NY tax in QB.

## 3. OPERATIONS RECORD (consumer: OPD / SousAI / account management)
- **Client stakeholders**: **[TBD — Kevin to provide]**. Michelle (prior TBJ relationship contact) left the org; current Buffalo contact pending. `[src: Kevin, 2026-07-15]`
- **Service pattern**: AAA per-meal, assumed to mirror CIN-KY (weekly, homestand-based). The 2019 draft scoped ~70 regular-season home games at ~80 meals/game — historical, likely not current volume.
- **Operational truth**: essentially undocumented for 2026. This account is the thinnest on operational detail as well as contractual.

## 4. RULINGS & DECISIONS (current dispositions; full reasoning in LEDGER)
| ID | Ruling (current state) | Status | as-of | LEDGER ref |
|---|---|---|---|---|
| C-10 | TBJ-NY Snack + Shake → **deactivate** (correct as no-price/inactive). Not missing prices. | CLOSED | 2026-07-14 (§U confirms) | §O (C-10), §U |
| Q6 | TBJ-NY has no operative contract on file (folder held only a 2019 historical draft). Confirmed gap, risk-accepted per Layer B (rate Joe-attested), highest doc-risk of the 11. | CONFIRMED GAP (risk-accepted) | 2026-07-14 | §K, §P |

## 5. OPEN ITEMS (what's not settled — owner + status)
| Item | Status | Owner | Blocking cert? | Note |
|---|---|---|---|---|
| **Operative Buffalo contract** | OPEN (highest doc-risk) | Kevin | No (risk-accepted, but visible) | No 2020–2026 SOW on file. Chase: (1) Dec 11 2018 MSA, (2) current-year Buffalo SOW or written rate confirmation. Business exposure: a Buffalo rate dispute would have the signed internal price but no client-countersigned contract to cite. |
| **Why $27.34** (rate justification) | OPEN | Kevin / Joe | No | Rate is Kevin-confirmed correct, but has no contract/invoice backing — only the signed sheet. Confirm how $27.34 was set + whether it escalates. An invoice (accounting pulling) would give independent backing. |
| `w_3rdpartyvendor` subcontractor | OPEN | Kevin | No | The 2019 draft's filename hints at a third-party vendor arrangement not detailed in the SOW body. Flag if PG references Buffalo third-party passthrough. |
| NY tax rate + net terms | PENDING (accounting pull) | Kevin's accounting team | No | No contract, no invoice yet. Accounting pulling invoice copies — NY rate + terms confirm from an actual invoice. SC emits pre-tax (R9) regardless. |
| Invoice sample for golden test | PENDING (accounting pull) | Kevin's accounting team | Phase E only | Accounting pulling copies. An invoice would ALSO give the $27.34 rate independent backing (evidence even without a contract). Closes TBJ-NY's slice of Sebastian #3. |

## 6. HISTORY (superseded facts — MARKED, never deleted)
- **The 2019 draft SOW** (`2019.04.16_Buffalo_Catering_SOW_v1.0_w_3rdpartyvendor.docx.pdf`): a Schedule "E" / SOW #4 under the Dec 11 2018 MSA. **Unsigned draft** ("Note to Draft" markup, placeholder dates), single-season (April X → Dec 1, 2019), never operative. Rate: **$18.75/meal** (plus tax). Scoped ~70 home games × 80 meals. Regular Season Estimated Aggregate ≈ $105,000 with a $22,050 prepayment + 10 semi-monthly $8,295 installments; postseason bi-weekly. **None of this is operative for 2026** — preserved as the only historical Buffalo document that exists. `[digest §B]`
- **The $18.75 → $27.34 gap**: today's operative rate ($27.34) is NOT derivable from the 2019 draft ($18.75) by any escalation — confirming the 2019 doc doesn't explain the current rate. `[digest §D]`
- **Level-tiering context**: the 2019 $18.75 Buffalo rate sat between TBJ-FL's FSL ($14.50) and MLB ($20.29) — level-appropriate tiering consistent with TBJ-FL logic, at a different absolute point. (Note: the "Single A Jays"/Vancouver line seen in other docs is NOT part of TBJ-NY — confirmed removed per Kevin 2026-07-15.) `[digest §D]`

## 7. PROVENANCE & ATTRIBUTION KEY (for this file)
- **Contract facts**: the ONLY document is the 2019 historical draft, verbatim in `../CONTRACT_DIGEST_TBJ-NY.md`. No operative contract exists to cite.
- **Per-service price ($27.34)**: signed Price Review v3 (Joe **Lessard**-attested) + PG match — assumption-only, no contract/invoice backing.
- **Money shape**: `../../SC_MONEY_MODEL.md` (No-SF assumption).
- **Rulings**: `../LEDGER.md` §O (C-10), §K/§P (Q6 gap).
- **Last reviewed**: 2026-07-15 by Kevin + Chat-Claude (Batch 1).

---
*Completeness: THIN (by design + honestly). No operative contract; only a 2019 unsigned historical draft. Operative rate $27.34 is Kevin-confirmed + Joe-attested + PG-matched (billing covered) but contractually unjustified (business exposure). HIGHEST documentation risk of the 11 — risk-accepted per Layer B, flagged visibly. Snack/Shake correctly deactivated. Open: the operative contract, the rate justification, current client contact. Invoice pull (accounting) will add independent rate backing + tax rate.*
