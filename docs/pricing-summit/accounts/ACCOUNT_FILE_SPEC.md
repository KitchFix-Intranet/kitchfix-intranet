# Account File Spec — the canonical per-account record

**Purpose**: defines the structure of `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md`, one per SC account. These files are the **system of record** for each account — the one place that answers "what does this account bill, why, on what authority, and what's still open." The LEDGER remains the decision-journal + evidence store; account files are the **current-state, retrievable** layer that points back to it.

**Design principles baked in** (do not drop any):
1. **Retrievable, not just readable** — structured sections + consistent field labels so a human or an AI can look up a fact, not hunt prose.
2. **Primary key = the intranet account name** (`STL-FL`, `CIN-AZ`, `TBJ-NY`…). Everything joins on this.
3. **Alias-aware** — a legend maps how people *actually search* to the primary key.
4. **Effective-dated** — every time-boxed fact (prices, fees, terms) carries an `as-of` and, where known, an expiry/supersession.
5. **Attributed where known, honest where not** — non-contract facts tag a source; unknown provenance = `unattributed` (no archaeology).
6. **Current-state vs. history separated** — current truth up top; superseded facts move to a History block, **marked and preserved, never deleted**.
7. **Status-flagged** — every open item marked `OPEN / NEEDS-DECISION / UNDER-REVIEW / CLOSED`.
8. **Billing-record and operations-record separated** — different consumers (bill export/PG vs OPD/SousAI).
9. **Completeness-marked** — each file declares how fully captured it is.

---

## FILE TEMPLATE (copy for each account)

```markdown
# ACCOUNT: <PRIMARY-KEY>   e.g. CIN-AZ
> Canonical record. Current-state above the fold; history preserved below. Primary key is the intranet account name.

## 0. IDENTITY & ALIASES (the crosswalk — join everything on the primary key)
- **Primary key (intranet)**: CIN-AZ
- **Team / entity**: Cincinnati Reds — Goodyear, AZ (player development complex)
- **Level / tier**: PDC (MLB Spring Training + MiLB)
- **Search aliases** (how people actually look for this): "Reds AZ", "Goodyear", "GY", "Cincinnati Spring Training", "Reds Arizona"
- **Crosswalk to other systems**:
  | System | How this account appears |
  |---|---|
  | Intranet (PRIMARY) | CIN-AZ |
  | PG (`sc_service_prices`) | <service_name rows, e.g. "Major League Breakfast", "Coffee Service"> |
  | QuickBooks (invoice `Item`) | <e.g. "CIN-AZ MLB - Breakfast..."> |
  | P&L file | <exact filename, note colon=slash> |
  | ABR OneSheeter tab | CINCINNATI REDS (shared tab — also covers CIN-OH) |
  | Contract folder | /Contracts/CIN AZ/ |
- **Capture completeness**: FULLY-CAPTURED | PARTIAL | THIN  — one line why.

## 1. CONTRACT (pointer, not duplication)
- **Operative doc**: <name + effective/exec dates>
- **Verbatim source-of-record**: `../CONTRACT_DIGEST_CIN-AZ.md` (do NOT restate terms; link)
- **Term / renewal**: <e.g. 2023 base, Renewal Term option, notice by Nov 1>  · as-of 2026
- **Paperwork status**: <e.g. 2026 renewal notice not in folder — see Open Items>

## 2. BILLING RECORD  (consumer: bill export / PG / finance)
### 2a. Money shape
- **Shape**: <flat-fee | per-meal | SF% | deposit-discount | opt-in> — one line.
- **Service Fee**: <amount + how computed>  · as-of 2026 · source: <contract §/ signed sheet>
- **SF cadence**: <due dates>  · source
- **Escalation regime**: <exact index + month + floor/cap OR "none/renegotiated" OR "fixed X%">  · source: contract §
- **Tax treatment**: <pre-tax always; exemptions if any>
### 2b. Rate table (effective-dated; the retrievable price list)
| Service | Rate (post-SF/billed) | Sticker (if applicable) | Unit | as-of | Source | PG match? |
|---|---|---|---|---|---|---|
| <e.g. MLB Breakfast> | $20.31 | $29.01 | per meal | 2026 | signed sheet R5 | yes (fix pending, was $20.32) |
| ... | | | | | | |
### 2c. Passthrough / non-revenue lines
- <line: what it is, cadence, who pays, is it revenue?>  · flag: passthrough / is_non_revenue / is_flat_fee
### 2d. Ancillary revenue (out of SC meal-model scope)
- <e.g. Owners Week Caterings + Fantasy Camp → P&L 2200; NOT in SC export>  · source
### 2e. Worked billing example (golden-test seed — to the penny)
- <one period: services × counts × rates = pre-tax subtotal that should equal the QB invoice>

## 3. OPERATIONS RECORD  (consumer: OPD / SousAI / account management)
- **Client stakeholders**: <names + role>  · as-of 2025 (source: OneSheeter)
- **Service pattern / notes**: <meal windows, staffing model, seasonal shape>
- **Operational truth not in contracts**: <the tribal knowledge — e.g. mix-shift, blend rationale>  · attribution
- **2026 asks / live conversations**: <billback, flat-fee move, action stations, etc.>

## 4. RULINGS & DECISIONS (current dispositions; full reasoning in LEDGER)
| ID | Ruling (current state) | Status | as-of | LEDGER ref |
|---|---|---|---|---|
| A-14 | MLB Breakfast = $20.31; PG fix pending | CLOSED | 2026-07-14 | §Q, §audit-batch |
| ... | | | | |

## 5. OPEN ITEMS  (what's not settled — owner + status)
| Item | Status | Owner | Blocking cert? | Note |
|---|---|---|---|---|
| 2026 renewal notice missing | OPEN | Kevin | No (risk-accepted) | chase Ashley |
| <A-10 disposition> | NEEDS-DECISION | Kevin | No | ... |

## 6. HISTORY  (superseded facts — MARKED, never deleted)
- <e.g. "2025 MLB Breakfast rate was $X (superseded by 2026 escalation, as-of 2026-01)">
- <prior rulings that were reversed, with what replaced them + date>

## 7. PROVENANCE & ATTRIBUTION KEY (for this file)
- Contract facts: page-cited in the digest (authoritative).
- Prices: signed Price Review v3, Joe Lessard-attested.
- Operational/tribal facts: tagged inline; `unattributed` where person/date unknown (not researched — captured from working sessions Jul 2026).
- Last reviewed: <date> by <who>.
```

---

## ATTRIBUTION CONVENTION (keep it light — no archaeology)
Inline tag on any non-contract fact: `[src: <who/what>, <when>, <confidence>]`.
- Known → `[src: Kevin, 2026-07-14, high]` or `[src: OneSheeter 2025, med]`
- Unknown → `[src: unattributed]` and move on. Do NOT hunt historical provenance.
- Confidence is coarse: high (attested/documented) / med (recalled/secondary) / low (inferred, flag for confirm).

## EFFECTIVE-DATING CONVENTION
- Every price/fee/term carries `as-of <year or date>`.
- When a value changes, the old one moves to §6 History with `superseded <date>`; the new one sits in current-state with its new `as-of`. Never overwrite silently.

## CHANGE-MANAGEMENT PROCESS (the update discipline)
1. New fact/term/rate arrives (new SOW, escalation, ruling reversal).
2. Move the affected current-state row to §6 History, tagged `superseded <date>, reason`.
3. Insert the new value in current-state with `as-of`.
4. Log the decision in the LEDGER (journal); reference it from §4.
5. Commit as its own small PR — git preserves the full history; the file always shows *current* truth on top.

## COMPLETENESS RUBRIC (§0 marker)
- **FULLY-CAPTURED**: contract banked + all rates + rulings closed + ops notes + worked example.
- **PARTIAL**: contract + rates solid; some rulings open or ops thin.
- **THIN**: known documentation gaps (e.g. TBJ-NY: no operative contract).
