# ACCOUNT: TBJ-NY
> Canonical record. Current-state above the fold; history preserved below (§6). Primary key is the intranet account name. Reasoning/decisions journaled in `../LEDGER.md`; verbatim contract terms in `../CONTRACT_DIGEST_TBJ-NY.md`.
> ⚠️ **HIGH DOCUMENTATION RISK — but reframed by invoice evidence (2026-07-16).** No standalone Buffalo contract on file, BUT invoice K300168849 confirms Buffalo bills through the **Toronto Blue Jays parent PDC** (Rogers Blue Jays Baseball Partnership, Dunedin FL) — i.e. Buffalo is a **sub-scope of the Toronto master relationship**, not an orphaned account. The $27.34 rate is now independently invoice-confirmed. The gap is "which SOW/MSA scopes Buffalo," not "no paper exists." Read §5.

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
  | QuickBooks (invoice `Item`) | Activity = **"Buffalo Meal Service"** (meal type in Description; all meal types bill at $27.34). `[invoice K300168849]` |
  | Invoice Bill-To / billing entity | **Rogers Blue Jays Baseball Partnership** / Toronto Blue Jays Player Development Complex / 3031 Garrison Road, Dunedin FL 34698 — i.e. Buffalo bills through the **parent Toronto PDC address** (SAME as TBJ-FL), NOT a Buffalo entity. Invoice recipient ("Sent to"): **Charlie Wilson**. `[invoice K300168849]` |
  | P&L file | Buffalo Bisons rows |
  | ABR OneSheeter tab | NOT included (the OneSheeter's "TORONTO BLUE JAYS" tab covers the relationship but Buffalo is treated as adjacent; ABR notes "How is Buffalo going?" as an open question) |
  | Contract folder | `/Contracts/TBJ NY/` (contained only a 2019 historical draft SOW — see §1/§6) |
- **Client stakeholders**: **Katarina Dimino** — client contact for both TBJ accounts (TBJ-NY + TBJ-FL) `[src: Kevin, 2026-07-16, high]`. (Invoice K300168849 was "Sent to" Charlie Wilson at the Toronto PDC — the AP/billing recipient, distinct from the account contact. Michelle, the prior relationship contact, left the org.)
- **Capture completeness**: **PARTIAL** (upgraded from THIN by invoice K300168849). No standalone Buffalo contract, but the invoice confirms Buffalo bills through the Toronto parent PDC (Rogers Blue Jays / Dunedin) — a sub-scope of the Toronto master (Dec 2018 MSA), not an orphaned account. Operative rate $27.34 is invoice-confirmed (+ Kevin + Joe + PG); tax/terms/cadence/worked-example all confirmed. Remaining gap is the Buffalo SOW document under the Toronto MSA — a chase, not a billing-accuracy hole.

## 1. CONTRACT (pointer, not duplication)
- **Operative doc**: **NONE ON FILE.** No 2020–2026 Buffalo SOW of any kind. The operative $27.34 rate has zero contemporary contract backing in the folder.
- **Only document present**: `2019.04.16_Buffalo_Catering_SOW_v1.0_w_3rdpartyvendor.docx.pdf` — a **2019 single-season SOW, UNSIGNED** (draft-review markup, "Note to Draft" comments, placeholder dates "April X, 2019"). HISTORICAL, never operative for 2026. `[digest §A]`
- **Verbatim source-of-record**: `../CONTRACT_DIGEST_TBJ-NY.md` (documents the 2019 draft verbatim + the gap precisely).
- **Governing master (NOT in folder, but now corroborated)**: the 2019 SOW references a Master Services Agreement between **Rogers Blue Jays Baseball Partnership and CJK Foods LLC, dated December 11, 2018** — this MSA is not in the folder. **Invoice K300168849 corroborates that Buffalo bills under this Rogers Blue Jays / Toronto PDC umbrella** (Bill-To = the Dunedin PDC address, same as TBJ-FL). So Buffalo is almost certainly scoped as an SOW under the same Dec 2018 MSA that governs TBJ-FL — the operative paper likely lives in the Toronto master, not a standalone Buffalo file.
- **Paperwork status**: the gap is now better-characterized — NOT "no contract exists" but "**the Buffalo SOW under the Dec 2018 Rogers/Toronto MSA isn't in our folder.**" Highest-priority chase: (1) the Dec 11, 2018 MSA, (2) the Buffalo SOW under it (or written rate confirmation). Owner: Kevin. Risk reduced from the pre-invoice posture (rate now invoice-confirmed; billing relationship now traced to the Toronto master).

## 2. BILLING RECORD (consumer: bill export / PG / finance)

### 2a. Money shape
- **Shape**: **Pure per-meal, NO service fee (assumption).** `actual_count × $27.34` = invoice. No SF, no passthrough — but this shape is *assumed* (mirrors CIN-KY, the sibling AAA account), NOT contract-confirmed, because there's no operative contract. `[MONEY_MODEL: No-SF assumption]`
- **Service Fee**: NONE (assumed; no contract to confirm).
- **Escalation regime**: **UNKNOWN** — no operative contract on file. The $27.34 rate is now **invoice-confirmed** (K300168849) + Kevin-confirmed + Joe-attested, but how it was originally set and whether/how it escalates remain undocumented (likely governed by the Dec 2018 MSA's escalation terms, unread).
- **Tax treatment**: **New York sales tax = 8.75%** (confirmed from invoice K300168849: $1,112.40 / $12,713.10 = 8.75% exact; = Erie County combined, 4% NY State + 4.75% Erie). SC emits pre-tax (R9). `[invoice K300168849]`

### 2b. Rate table (effective-dated; the retrievable price list)
> No SF, so sticker = billed rate. The rate is **assumption-only** — Joe-attested via the signed sheet + PG-matched, but with no operative contract behind it. All as-of 2026.

| Service | Billed rate | Unit | as-of | Source | PG match |
|---|---|---|---|---|---|
| Breakfast | **$27.34** | per meal | 2026 | signed sheet + Kevin-confirmed + **invoice K300168849** | PG $27.34 ✓ · invoice bills $27.34 ✓ |
| Lunch | $27.34 | per meal | 2026 | signed sheet + invoice | PG $27.34 ✓ · invoice ✓ |
| Post-Game | $27.34 | per meal | 2026 | signed sheet + invoice | PG $27.34 ✓ · invoice ✓ |
| Umpire | $27.34 | per meal | 2026 | signed sheet | PG $27.34 ✓ (not on sampled invoice, but same rate) |
| Snack | — (deactivated) | — | 2026 | signed sheet | PG $0, inactive `[C-10 ruled: deactivate]` |
| Shake | — (deactivated) | — | 2026 | signed sheet | PG $0, inactive `[C-10 ruled: deactivate]` |

**Rate-table notes:**
- **The $27.34 rate is now INVOICE-CONFIRMED** (K300168849, every line at $27.34 regardless of meal type) — in addition to Kevin-confirmed + Joe-attested + PG-matched. This closes the "least-supported price" concern: the *number* is now backed by an actual client invoice, the strongest evidence short of a countersigned contract. What remains missing is only the *contract document* scoping Buffalo (likely an SOW under the Dec 2018 Toronto MSA). The 2019 draft rate was $18.75 (superseded).
- **All meal types bill at the same $27.34** — Breakfast, Lunch, and Post-Game are one flat rate (invoice carries meal type in the description, not as separate-priced SKUs).
- **Snack + Shake are correctly DEACTIVATED** ($0/inactive) per the C-10 ruling — confirmed by the invoice showing NO snack/shake lines. `[LEDGER §O, C-10; §U confirms; invoice K300168849]`

### 2c. Passthrough / non-revenue lines
- **NONE.** Invoice K300168849 shows straight per-meal billing with no passthrough or third-party line. The `w_3rdpartyvendor` hint from the 2019 draft filename (§6) has **no representation on the current invoice** — either retired or on a different invoice type. `[invoice K300168849]`

### 2d. Ancillary revenue (out of SC meal-model scope)
- **NONE identified.**

### 2e. Worked billing example (golden-test seed — to the penny)
- **CONFIRMED from invoice K300168849 (2026-06-21, unpaid at extraction)** — a real weekly period, Tue 6/16 → Sun 6/21:
  - "Buffalo Meal Service" lines @ **$27.34**: 6/16 Lunch (50), 6/17 Breakfast+Postgame (105), 6/18 Lunch+Postgame (105), 6/19 Lunch+Postgame (105), 6/20 Lunch (50), 6/21 Breakfast (50)
  - **Pre-tax subtotal $12,713.10** · NY tax $1,112.40 (**8.75%** Erie County exact) · **grand total $13,825.50**
- **Golden-test seed**: the SC per-period export for this window must reproduce **$12,713.10 pre-tax** (tax applied downstream in QB). `[invoice K300168849]`

## 3. OPERATIONS RECORD (consumer: OPD / SousAI / account management)
- **Client stakeholders**: **Katarina Dimino** — client contact for both TBJ accounts `[src: Kevin, 2026-07-16, high]`. Invoice recipient (AP) is Charlie Wilson at the Toronto PDC; Michelle (prior contact) left the org.
- **Billing structure**: Buffalo bills through the **Toronto Blue Jays parent PDC** (Rogers Blue Jays Baseball Partnership, Dunedin FL) — the same billing address as TBJ-FL. Buffalo is a sub-scope of the Toronto relationship, not a standalone contracting entity. `[invoice K300168849]`
- **Service pattern**: AAA per-meal, **confirmed weekly Sunday-invoiced cadence, ~6-day service period (Tue-Sun)** — matches CIN-KY's pattern. Invoice K300168849 covered 6/16-6/21 (Breakfast/Lunch/Postgame at 50-55 counts/meal). `[invoice K300168849]`
- **Operational truth**: still thin on contract, but billing mechanics now observed (rate, cadence, tax, entity all confirmed from the invoice).

## 4. RULINGS & DECISIONS (current dispositions; full reasoning in LEDGER)
| ID | Ruling (current state) | Status | as-of | LEDGER ref |
|---|---|---|---|---|
| C-10 | TBJ-NY Snack + Shake → **deactivate** (correct as no-price/inactive). Not missing prices. | CLOSED | 2026-07-14 (§U confirms) | §O (C-10), §U |
| Q6 | TBJ-NY has no standalone Buffalo contract on file (folder held only a 2019 historical draft). Invoice K300168849 reframes this: Buffalo bills through the Toronto parent PDC → sub-scope of the Dec 2018 Rogers/Toronto MSA, not an orphan. Rate now invoice-confirmed. Risk materially reduced. | REFRAMED (reduced risk) | 2026-07-16 (invoice) | §K, §P |

## 5. OPEN ITEMS (what's not settled — owner + status)
| Item | Status | Owner | Blocking cert? | Note |
|---|---|---|---|---|
| **Buffalo SOW under the Dec 2018 Toronto MSA** | OPEN (reduced risk) | Kevin | No | NOT "no contract exists" — the invoice traces Buffalo billing to the Rogers/Toronto PDC umbrella, so the operative paper is almost certainly an SOW under the Dec 11 2018 MSA (same master as TBJ-FL). Chase: (1) the MSA, (2) the Buffalo SOW under it. Risk reduced now that the rate is invoice-confirmed + the billing relationship is traced. |
| Client contact | ✓ CONFIRMED (Katarina Dimino) | — | No | Katarina Dimino is the client contact for both TBJ accounts. Charlie Wilson is the AP/billing recipient on invoices. Closed. |
| **Why $27.34** (rate justification) | OPEN (lower priority) | Kevin / Joe | No | Rate now invoice-confirmed + Kevin-confirmed + Joe-attested. The *number* is solid; only the contract *document* scoping it is missing (likely the Dec 2018 MSA escalation terms). |
| NY tax rate + net terms | ✓ CONFIRMED | — | No | Invoice K300168849: NY tax 8.75% (Erie County), Net 30, weekly Sunday cadence. Was pending; now closed. |
| Invoice sample for golden test | ✓ RECEIVED | — | closes TBJ-NY slice of Sebastian #3 | Invoice K300168849 obtained + worked example built (§2e). Independent $27.34 confirmation. |

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
*Completeness: THIN → PARTIAL (upgraded by invoice K300168849, 2026-07-16). No standalone Buffalo contract, but the invoice traces billing to the Toronto parent PDC (Rogers Blue Jays / Dunedin) — Buffalo is a sub-scope of the Toronto master (Dec 2018 MSA), not an orphan. Rate $27.34 now INVOICE-CONFIRMED (+ Kevin + Joe + PG); NY tax 8.75%, Net 30, weekly cadence confirmed; worked example built ($12,713.10 pre-tax). Snack/Shake deactivated (confirmed by invoice). Client contact = Katarina Dimino. Remaining open: the Buffalo SOW under the Toronto MSA. Doc-risk materially reduced from the pre-invoice posture.*
