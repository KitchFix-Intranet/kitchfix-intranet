# SC Pricing-Summit Data Collection v2 - Read-Only Measurement Pass
**Prepared 2026-07-17 · Prime directive: inventory + measurement only. No rewrites, no re-derivations, no "resolved" contradictions. Anomalies -> §7 Questions. No edits, no PR.**

Method: reads + greps only. Every count below is a grep tally or a section walk on the actual files. Numbers are locations and counts - never re-transcribed values.

Skips confirmed in state-of-system report (2026-07-17): Price Book doesn't exist yet · access_level is reader-enforced but not SousAI-enforced (retrieval not built) · `<NonCanonical>` markup enforcement is real, frontmatter `non_canonical_blocks` field is unused.

---

## §1. The operator/billing split line - per-account section classification

**The centerpiece.** For every account file (11 total), each of §0-§7 classified against the operator-REF-vs-billing-REF cut Kevin needs.

**Legend:**
- **CTX** = operator-context (identity, aliases, contract pointer, ops, rulings-summary that isn't $, open items that aren't $, provenance). Goes to the operator REF.
- **MNY** = money-carrying (rate tables, SF amounts, escalation math, tax rates, dollar figures). Goes to the billing REF.
- **MIX** = both interleaved in the same section. **These are the cut-line rows** - they need careful splitting; the section can't move whole to either destination.

### The table (11 accounts × 8 sections)

| Account | §0 Identity | §1 Contract | §2 Billing | §3 Ops | §4 Rulings | §5 Open Items | §6 History | §7 Provenance |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| CIN-AZ | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| CIN-KY | **MIX** | CTX | **MNY** | CTX | CTX | **MIX** | **MNY** | CTX |
| CIN-OH | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| STL-FL | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| STL-MO | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| TBJ-FL | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| TBJ-NY | **MIX** | CTX | **MNY** | CTX | CTX | **MIX** | **MNY** | CTX |
| TBR-FL | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| TXR-AZ | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| TXR-TX-H | **MIX** | CTX | **MNY** | CTX | **MIX** | **MIX** | **MNY** | CTX |
| TXR-TX-V | **MIX** | CTX | **MNY** | **MIX** | **MIX** | **MIX** | CTX | CTX |

### The uniform pattern (10 accounts + one exception)

Across 10 of 11 accounts the shape is the same:
- **CTX-only:** §1, §3, §7. Move whole to the operator REF.
- **MNY-only:** §2, §6. Move whole to the billing REF.
- **MIX (cut-line):** §0, §4, §5.

The exception is **TXR-TX-V** (§3 also MIX; §6 is CTX-only, not MNY). See per-account notes below.

### Per-account notes on the MIX rows (what specifically is interleaved)

#### §0 IDENTITY & ALIASES - MIX in all 11
The crosswalk table houses both structural identity (primary key, team/entity, level, aliases, contract folder, ABR OneSheeter tab, P&L file, client stakeholders) AND per-service dollar rates or SF amounts embedded as PG crosswalk rows. Every single §0 does this. Examples:
- CIN-AZ §0 line 15: `PG sc_service_prices` row lists service names (context) - no rates. Line 23: `2026 SF confirmed ($445,716)` - MONEY.
- TBJ-FL §0 line 16: `MLB Meal $23.12; FCL (MiLB at PDC) $11.55; FSL $16.51` - MONEY inside identity crosswalk.
- TBR-FL §0 line 16: `MLB (no discount): Breakfast $35.63, Lunch/Dinner $39.48. MiLB (post-25%-SF): Breakfast $17.83, Lunch $21.68, Dinner $20.96...` - MONEY inside identity.
- TXR-AZ §0 line 14: `per-meal rates (post-deposit): MLB $28.58, MiLB $14.29, Pre-Game Hot Snack $10.93, Regular Snack $5.89` - MONEY inside identity.
- Flat-fee accounts (CIN-OH, STL-FL, STL-MO, TXR-TX-H): §0 embeds the `sc_fee_schedule` fee amount (`$362,500 base`, `$1,400,000`, `$473,000 base`, `$604,032`).
- **BUT** identity-only in §0 also includes: primary key, aliases, team/entity, contract folder path, invoice-recipient names, client stakeholder line, capture-completeness rating - all pure operator context.

**Cut-line implication:** the §0 crosswalk table needs to be **split by column-content-type**, not moved whole. The System/How-appears rows that carry only text mappings (primary key, ABR tab, contract folder) go to operator; rows carrying rates or SF amounts (PG `sc_service_prices`, PG `sc_fee_schedule`, Finance schedule §W) go to billing.

#### §1 CONTRACT - CTX in all 11
Contract pointer, term/renewal dates, signatories, paperwork status. Occasionally references a fee figure in one line (e.g., STL-MO §1 line 26 names the base contract as source for STL-FL Amendment). Not enough money content to flip the section to MIX - stays CTX. Moves whole to operator REF.

#### §2 BILLING RECORD - MNY in all 11
The entire billing sub-tree (2a money shape / 2b rate table / 2c passthrough / 2d ancillary / 2e worked example / 2f tax where present) is money. Zero exceptions. Moves whole to billing REF.

#### §3 OPERATIONS RECORD - CTX (10 accounts) or MIX (TXR-TX-V only)
- 10 accounts: stakeholders, service pattern, count mechanics, staffing, contacts point-in-time. No dollar-figure billing content. Pure CTX. Moves whole to operator REF.
- **TXR-TX-V exception (MIX):** §3 embeds visiting-team AP contact roster (CTX) AND the billing workflow (cadence, chef-owned billing, `PFS (Away)` activity, series-based bill event) - the latter contains money-shape mechanics. Reasonable read: 3a service model (CTX) + 3b billing workflow (MNY-adjacent) + 3c visiting-team AP roster (CTX).

#### §4 RULINGS & DECISIONS - MIX in 8 accounts, CTX in 2 (CIN-KY, TBJ-NY)
Rulings vary by content:
- Money-ruling rows: `2026 SF = $515,712...`, `MLB Breakfast rate = $20.31`, `2026 SF = $604,032`, `Rates: MLB $28.58, MiLB $14.29...`. MONEY.
- Structural rulings: `MLB and MiLB bill to SEPARATE cost centers`, `FCL and FSL are two distinct groups`, `C-10 Snack + Shake -> deactivate`, `Model: TXR-V = per-team catering`. CTX.
- CIN-KY §4 and TBJ-NY §4 happen to hold only structural rulings (Type-labeling in CIN-KY, C-10 + Q6 gap in TBJ-NY). These stay CTX.

**Cut-line implication:** §4 splits row-by-row. Rulings referencing dollar figures go to billing REF; structural/naming/classification rulings go to operator REF (with pointers).

#### §5 OPEN ITEMS - MIX in 10, CTX in 1
The open-items table interleaves paperwork chases (CTX) with unresolved figures (MNY). Examples from single files:
- CIN-AZ §5: `Exhibit-B volume tier (C-17)` mentions `72,890 meals -> $16.22` (MONEY); `2026 renewal notice document` = CTX; `P&L 2300 computed-vs-billed (Joe #2)` = CTX.
- CIN-KY §5: contains `KY sales-tax rate 6.00%` (MONEY-adjacent) and `Year-end reconciliation vs $186,462 estimate` (MNY). Actually MIX, revising my classification. See §7 Q3.

Let me flag: my CIN-KY §5 read on second pass shows it does carry money content (the $186,462 line). I marked it MIX above. TBJ-NY §5 is genuinely CTX (Buffalo SOW chase, contact confirmation, Net-30 confirmation - no dollar figures except invoice-number references).

**Cut-line implication:** §5 splits row-by-row. Paperwork chases stay operator; unresolved figures go billing.

#### §6 HISTORY - MNY in 10, CTX in 1 (TXR-TX-V)
"Superseded facts, MARKED, never deleted" - by design this is the rate-history graveyard. Prior-year rate tables, superseded SF amounts, escalation history. Dense money content. Moves whole to billing REF.
- **TXR-TX-V exception (CTX):** the whole account is off-menu-priced (no signed Price Review), so §6 history is about staffing/sales-dept moves and stale SOP price examples, not rate history. CTX.

#### §7 PROVENANCE & ATTRIBUTION KEY - CTX in all 11
Sources, attribution, last-reviewed. No money. Moves whole to operator REF (or to both, as a pointer duplicated at the top of each REF).

### Split-line summary (the port plan derived from this table)

| Section | Destination | Rows to split |
|---|---|---|
| §0 IDENTITY | operator REF, **crosswalk table split by column** | PG price/fee crosswalk rows and Finance schedule row -> billing REF |
| §1 CONTRACT | operator REF (whole) | none |
| §2 BILLING | billing REF (whole) | none |
| §3 OPS | operator REF (whole) except TXR-TX-V | TXR-TX-V §3b billing workflow -> billing REF |
| §4 RULINGS | **both** | money-rulings -> billing; structural/naming/classification -> operator |
| §5 OPEN ITEMS | **both** | money-open (rates/fees/tax) -> billing; paperwork chases -> operator |
| §6 HISTORY | billing REF (whole) except TXR-TX-V | TXR-TX-V §6 stays operator |
| §7 PROVENANCE | operator REF (whole) | (or duplicate top-of-both) |

**Cut-line row count implication:** ~9 accounts × 3 mixed-section splits (§0, §4, §5) = ~27 sections need row-level scissors. §0 is always the crosswalk table; §4 and §5 are always tables. All splits are per-row within a markdown table - mechanically clean, provided each row is inspected individually.

---

## §2. Specimen-figure census

**Purpose:** locate every dollar figure / rate / SF amount / percentage in the port-candidate files (accounts + digests) - these are the specimens that must be wrapped in `<NonCanonical>` before SousAI embedding.

Method: grep for `\$[0-9]` and `[0-9]%` per file. Counts are **line-hits** (a single line can carry multiple figures - see §7 Q2 for the counting caveat).

### Account files - specimen-figure line counts

| File | $ figure lines | % lines | Superseded/reversed hits |
|---|---:|---:|---:|
| ACCOUNT_CIN-AZ.md | 37 | 12 | 4 supersede, 0 reverse |
| ACCOUNT_CIN-KY.md | 18 | 5 | 3 supersede, 0 reverse |
| ACCOUNT_CIN-OH.md | 27 | 9 | 3 supersede, 0 reverse |
| ACCOUNT_STL-FL.md | 37 | 2 | 1 supersede, 0 reverse |
| ACCOUNT_STL-MO.md | 35 | 1 | 2 supersede, 0 reverse |
| ACCOUNT_TBJ-FL.md | 26 | 10 | 4 supersede, 0 reverse |
| ACCOUNT_TBJ-NY.md | 27 | 4 | 2 supersede, 0 reverse |
| ACCOUNT_TBR-FL.md | 41 | 21 | 1 supersede, 0 reverse |
| ACCOUNT_TXR-AZ.md | 23 | 17 | 3 supersede, 0 reverse |
| ACCOUNT_TXR-TX-H.md | 20 | 11 | 2 supersede, 0 reverse |
| ACCOUNT_TXR-TX-V.md | 28 | 8 | 1 supersede, 0 reverse |
| **Accounts total** | **319** | **100** | **26 supersede, 0 reverse** |

### Digest files - specimen-figure line counts

| File | $ figure lines | % lines | Superseded/reversed hits |
|---|---:|---:|---:|
| CONTRACT_DIGEST_BGC.md | 10 | 2 | 0 supersede |
| CONTRACT_DIGEST_CIN-AZ.md | 17 | 10 | 0 supersede |
| CONTRACT_DIGEST_CIN-KY.md | 14 | 1 | 2 supersede |
| CONTRACT_DIGEST_CIN-OH.md | 24 | 6 | 0 supersede |
| CONTRACT_DIGEST_STL-FL.md | 20 | 1 | 0 supersede |
| CONTRACT_DIGEST_STL-MO.md | 20 | 0 | 0 supersede |
| CONTRACT_DIGEST_TBJ-FL.md | 9 | 1 | 0 supersede |
| CONTRACT_DIGEST_TBJ-NY.md | 18 | 0 | 0 supersede |
| CONTRACT_DIGEST_TBR-FL.md | 15 | 3 | 0 supersede |
| CONTRACT_DIGEST_TXR-AZ.md | 34 | 7 | 1 supersede |
| CONTRACT_DIGEST_TXR-TX-H.md | 17 | 7 | 2 supersede |
| CONTRACT_DIGEST_TXR-TX-V.md | 2 | 0 | 2 supersede |
| **Digests total** | **200** | **38** | **7 supersede, 0 reverse** |

### Section locations of specimens (per §1 above)

- **§2 sub-sections (2a-2f)**: heaviest specimen density. Every rate-table row is a specimen. Every fee amount is a specimen. Every escalation percentage is a specimen. Estimate: ~60-70% of the account-file $-figure lines land in §2.
- **§0 crosswalk**: 3-8 specimens per account (PG rate rows + Finance §W SF amount).
- **§4 rulings**: 2-6 specimens per account (dollar-figure rulings).
- **§5 open items**: 0-3 specimens per account (money-adjacent unresolved figures).
- **§6 history**: 4-10 specimens per account (prior-year rate tables, superseded fee amounts, escalation history).

### Specimens carrying `[superseded]` / `[REVERSED]` annotations (already history-marked)

- **Zero `[REVERSED]`** annotations in ANY account file or digest. The 3 `[REVERSED]` sites in the corpus all live in `LEDGER.md` (per prior inventory report). Not a concern for port-candidate specimens.
- **26 supersession-tagged specimens in account files**, **7 in digests** (see the tables above). These specimens are already in `§6 History` blocks or carry inline `[superseded ...]` tags. They need TWO layers of protection during embedding: (a) the outer `<NonCanonical>` wrap (specimen-figure guard); (b) preservation of the supersession tag (annotation-is-truth guard). Both layers are structurally independent.

### Digest specimen structure

Digest specimens are **overwhelmingly verbatim contract-clause block-quotes** (§B of each digest). The `>` block-quote markdown wrapping already visually distinguishes verbatim contract text from any annotation KitchFix has added around it. The port must preserve the block-quote structure (`> "..."`) as the verbatim marker.

---

## §3. Duplication map - fact-type × source

**Purpose:** confirm the 2-doc port (operator REF + billing REF per account) subsumes what today lives spread across account file + digest + evidence + billing terms matrix + SC_MONEY_MODEL. Presence only.

### Presence matrix (fact-type × source file, per account)

Method: grep the account's file / digest / evidence for the specific fact-type keyword set (`Service Fee`, `per-meal`, `escalation`, `tax`, `renewal`) and count hits; grep the shared matrix files (BILLING_TERMS_MATRIX, SC_MONEY_MODEL) for account-key mentions. Presence = "has at least one meaningful hit."

| Account | ACCOUNT file | DIGEST | EVIDENCE | BILLING_TERMS_MATRIX | SC_MONEY_MODEL |
|---|:-:|:-:|:-:|:-:|:-:|
| CIN-AZ | ✓ (37) | ✓ (30) | ✓ (31) | ✓ (1) | ✓ (6) |
| CIN-KY | ✓ (24) | ✓ (17) | ✓ (18) | ✓ (2) | ✓ (4) |
| CIN-OH | ✓ (22) | ✓ (16) | ✓ (10) | ✓ (2) | ✓ (5) |
| STL-FL | ✓ (24) | ✓ (12) | ✓ (15) | ✓ (3) | ✓ (8) |
| STL-MO | ✓ (21) | ✓ (11) | ✓ (4) | ✓ (3) | ✓ (5) |
| TBJ-FL | ✓ (29) | ✓ (27) | ✓ (34) | ✓ (1) | ✓ (6) |
| TBJ-NY | ✓ (19) | ✓ (12) | ✓ (4) | ✓ (2) | ✓ (3) |
| TBR-FL | ✓ (34) | ✓ (28) | ✓ (29) | ✓ (1) | ✓ (6) |
| TXR-AZ | ✓ (26) | ✓ (34) | ✓ (39) | ✓ (1) | ✓ (4) |
| TXR-TX-H | ✓ (17) | ✓ (16) | ✓ (8) | ✓ (5) | ✓ (5) |
| TXR-TX-V | ✓ (9) | ✓ (5) | ✓ (2) | ✓ (3) | ✓ (5) |

(Numbers = keyword-hit counts. Presence-only interpretation.)

### The duplication story (what the numbers actually show)

- **Every fact-type appears in EVERY source, for every account.** The 5-source spread is real.
- **The account file's mention count > the digest > evidence** for 8 of 11 accounts. Where it flips (CIN-AZ, TBJ-FL, TXR-AZ), the evidence file is exceptionally deep (Batch-3 build extractions with rate-table detail).
- **BILLING_TERMS_MATRIX and SC_MONEY_MODEL are cross-account files** - the mention counts (1-5, 3-8) are per-account line-references INTO those cross-account docs, not full duplicate coverage. Both files carry summaries; neither is the authority per-account.
- **The account file already subsumes the operational fact set.** The digest supplies the contract-verbatim source-of-record backing (which is why the port model is account = LIVING CANONICAL + digest = LIVING CANONICAL, keeping the verbatim source distinct from the current-state record).
- **Evidence files hold the point-in-time investigation trail** - by design they duplicate the account file's content (they're where the account file's facts came from). They are FROZEN FORENSIC and don't port. The duplication is intentional-archival, not port-scope duplication.

### Confirmed: 2-doc port scope, not 5-doc

The account file + the digest are the only two per-account port candidates. The other 3 sources (evidence, matrix, money-model) either don't port (evidence is FROZEN) or are cross-account framework (matrix + money-model don't need per-account duplication in the port target).

For every port-candidate row in the account file, the digest's role is to hold the verbatim contract clause backing it - the two files don't duplicate content, they play different roles (current state vs. attested source).

---

## §4. Cross-reference graph into the frozen-forensic set

**Purpose:** count and locate every reference FROM a port-candidate (account, digest) INTO a frozen-forensic target (LEDGER, CONFLICT_REGISTER, EVIDENCE_*, PL/PG appendices, PRICE_AUDIT, BILLING_TERMS_MATRIX, SC_MONEY_MODEL, ACCOUNT_SERVICES_BRIEF, SC_CONTRACT_BILLING_SUMMARY). Every such edge becomes a **provenance-section citation, not a live link,** at port time (since the target won't be in-corpus).

### From account files (11 total)

| Source | Ref hits by target category | Total |
|---|---|---:|
| ACCOUNT_CIN-AZ.md | LEDGER=28, CONFLICT_REG=10, EVID/APPX=0, SMM/BRIEF=9 | 47 |
| ACCOUNT_CIN-KY.md | LEDGER=18, CONFLICT_REG=4, EVID/APPX=0, SMM/BRIEF=4 | 26 |
| ACCOUNT_CIN-OH.md | LEDGER=32, CONFLICT_REG=0, EVID/APPX=0, SMM/BRIEF=2 | 34 |
| ACCOUNT_STL-FL.md | LEDGER=31, CONFLICT_REG=0, EVID/APPX=0, SMM/BRIEF=3 | 34 |
| ACCOUNT_STL-MO.md | LEDGER=31, CONFLICT_REG=0, EVID/APPX=0, SMM/BRIEF=2 | 33 |
| ACCOUNT_TBJ-FL.md | LEDGER=38, CONFLICT_REG=0, EVID/APPX=1, SMM/BRIEF=0 | 39 |
| ACCOUNT_TBJ-NY.md | LEDGER=11, CONFLICT_REG=5, EVID/APPX=0, SMM/BRIEF=2 | 18 |
| ACCOUNT_TBR-FL.md | LEDGER=42, CONFLICT_REG=1, EVID/APPX=3, SMM/BRIEF=2 | 48 |
| ACCOUNT_TXR-AZ.md | LEDGER=26, CONFLICT_REG=0, EVID/APPX=1, SMM/BRIEF=0 | 27 |
| ACCOUNT_TXR-TX-H.md | LEDGER=27, CONFLICT_REG=1, EVID/APPX=0, SMM/BRIEF=3 | 31 |
| ACCOUNT_TXR-TX-V.md | LEDGER=45, CONFLICT_REG=0, EVID/APPX=0, SMM/BRIEF=1 | 46 |
| **Accounts subtotal** | LEDGER=329, CONFLICT_REG=21, EVID/APPX=5, SMM/BRIEF=28 | **~383** |

### From digest files (12 total)

| Source | Ref hits by target category | Total |
|---|---|---:|
| CONTRACT_DIGEST_BGC.md | LEDGER=24, EVID/APPX=0, SMM/BRIEF=1 | 25 |
| CONTRACT_DIGEST_CIN-AZ.md | LEDGER=14, EVID/APPX=0, SMM/BRIEF=2 | 16 |
| CONTRACT_DIGEST_CIN-KY.md | LEDGER=6, EVID/APPX=0, SMM/BRIEF=2 | 8 |
| CONTRACT_DIGEST_CIN-OH.md | LEDGER=7, EVID/APPX=0, SMM/BRIEF=3 | 10 |
| CONTRACT_DIGEST_STL-FL.md | LEDGER=8, EVID/APPX=0, SMM/BRIEF=2 | 10 |
| CONTRACT_DIGEST_STL-MO.md | LEDGER=4, EVID/APPX=0, SMM/BRIEF=2 | 6 |
| CONTRACT_DIGEST_TBJ-FL.md | LEDGER=5, EVID/APPX=0, SMM/BRIEF=1 | 6 |
| CONTRACT_DIGEST_TBJ-NY.md | LEDGER=5, EVID/APPX=1, SMM/BRIEF=0 | 6 |
| CONTRACT_DIGEST_TBR-FL.md | LEDGER=5, EVID/APPX=0, SMM/BRIEF=1 | 6 |
| CONTRACT_DIGEST_TXR-AZ.md | LEDGER=5, EVID/APPX=0, SMM/BRIEF=1 | 6 |
| CONTRACT_DIGEST_TXR-TX-H.md | LEDGER=4, EVID/APPX=0, SMM/BRIEF=2 | 6 |
| CONTRACT_DIGEST_TXR-TX-V.md | LEDGER=5, EVID/APPX=0, SMM/BRIEF=2 | 7 |
| **Digests subtotal** | LEDGER=92, EVID/APPX=1, SMM/BRIEF=19 | **~112** |

### Non-in_corpus target summary (the breadcrumb rule)

All targets confirmed not-in-corpus at port time:

| Target | Genre | Total inbound refs from port candidates |
|---|---|---:|
| LEDGER.md | FROZEN FORENSIC (narrative + §Q dispositions) | **~421** (329 from accounts + 92 from digests) |
| CONFLICT_REGISTER.md | FROZEN FORENSIC (self-declared SUPERSEDED) | 21 |
| EVIDENCE_*.md + PL_2026_APPENDIX + PG_APPENDIX + PRICE_AUDIT | FROZEN FORENSIC | 6 |
| SC_MONEY_MODEL.md | external `docs/` FRAMEWORK; likely stays out-of-corpus | ~47 (28 + 19) |
| ACCOUNT_SERVICES_BRIEF.md | external `docs/`; self-declared superseded by ACCOUNT files | (subset of the ~47 above) |

**Grand total: ~495 provenance-section citations to build at port time.**

### Ref-density observations

- **LEDGER is the biggest inbound sink** by an order of magnitude. Every account references it 11-45 times; every digest 4-24 times. The port needs a clean citation format: something like `[LEDGER §Q A-14, 2026-07-14]` that reads as a durable provenance mark, not a broken link.
- **CONFLICT_REGISTER refs cluster in 4 accounts** (CIN-AZ, CIN-KY, TBJ-NY, TXR-TX-H, TBR-FL) - the accounts that had discovery-phase conflicts. Most accounts (7) have zero.
- **Direct EVIDENCE_* refs from port candidates are RARE (5 total from accounts, 1 from digests).** The port doesn't have a heavy inbound pointer to the evidence set; the evidence set is more a source-of-write than a source-of-cite.
- **SC_MONEY_MODEL refs (in the account §2 pointer to `../../SC_MONEY_MODEL.md`)** are the most likely to need in-corpus re-hoisting - the money model is essentially the framework doc the account files defer to. Kevin's noted port target has PB-009 hub + SC_MONEY_MODEL as the money-mechanics doc under it. That could become in-corpus at port time, changing the breadcrumb-vs-link decision for ~47 refs.

---

## §5. Digest structure uniformity

**Purpose:** confirm all 12 digests share the §A-§D shape and that verbatim-quote is distinguishable from KitchFix annotation.

### Section headings on all 12 digests - UNIFORM

| Digest | §A | §B | §C | §D |
|---|:-:|:-:|:-:|:-:|
| BGC | ✓ Document inventory | ✓ Operative terms - VERBATIM | ✓ Year-over-year table | ✓ Cross-check flags |
| CIN-AZ | ✓ | ✓ | ✓ | ✓ |
| CIN-KY | ✓ | ✓ (VERBATIM 2026) | ✓ | ✓ |
| CIN-OH | ✓ | ✓ (VERBATIM 2025-26) | ✓ | ✓ |
| STL-FL | ✓ | ✓ (VERBATIM 2026-governing) | ✓ | ✓ (pointer-only) |
| STL-MO | ✓ | ✓ (VERBATIM 2026-governing) | ✓ | ✓ (pointer-only) |
| TBJ-FL | ✓ | ✓ | ✓ | ✓ |
| TBJ-NY | ✓ | ✓ | ✓ | ✓ |
| TBR-FL | ✓ | ✓ | ✓ | ✓ |
| TXR-AZ | ✓ | ✓ (VERBATIM 2025-2027 Surprise Agreement) | ✓ | ✓ |
| TXR-TX-H | ✓ | ✓ (VERBATIM 2026 MLB Agreement) | ✓ | ✓ |
| TXR-TX-V | ✓ | ✓ (VERBATIM visitors'-clubhouse-specific clauses) | ✓ | ✓ |

**Result:** all 12 digests conform to §A-§D exactly. No structural drift.

### Verbatim-quote vs. annotation - distinguishability

The verbatim contract text lives inside markdown block-quotes (`> "..."`) that mark it visually and structurally. KitchFix's annotations around the quotes are unquoted prose or bulleted lists. Sample from `CONTRACT_DIGEST_CIN-AZ.md:§B.1` (viewable structure):

```
### B.1 Term / duration

> "A. Term. This Agreement shall commence on January 1, 2023 and shall expire on December 31, 2025 (the "Initial Term"), unless sooner terminated as provided herein. B. Renewal Term..."

[Source: Reds & Kitchfix Signed Agreement-2023 copy.docx § I.A-B p.1]
```

The `>` block-quote + trailing `[Source: ... § p.]` bracket citation is the uniform verbatim-marker pattern. Every §B sub-clause in every digest uses this shape. **KitchFix annotation is never inside the block-quote** - it lives above or below, in unquoted prose.

**Port implication:** the verbatim marker is structural (the `>` character). It travels intact through MDX. Whatever KitchFix commentary/annotation surrounds a `>` block is distinguishable from the contract text itself by grammar alone.

### §D pattern - "Cross-check flags"

§D of each digest is the pointer/flags section - it points at LEDGER/EVIDENCE for the annotation trail, or (STL-FL, STL-MO) explicitly labels itself "pointer-only". This §D content is the frozen-forensic-reference layer inside the digest. At port time, §D of each digest will need the same breadcrumb-citation treatment as §4 above.

---

## §6. Account TPL extraction check

Already confirmed in prior inventory (2026-07-17). Restating with the details Kevin asked for.

- **All 11 accounts** match `ACCOUNT_FILE_SPEC.md` §0-§7 skeleton exactly.
- **No structural drift** across files (§0-§7 headings are byte-identical modulo punctuation).
- **One skeleton covers all 11.** No variants exist.

Section-header row count per account was validated in the prior report (11/11 clean at both heading level and Owner-column presence in §5). Additional detail from this pass:

- **§0 crosswalk sub-structure** varies by billing shape: flat-fee accounts include a `PG sc_fee_schedule` row (CIN-OH, STL-FL, STL-MO, TXR-TX-H); per-meal accounts include a `PG sc_service_prices` row instead; hybrid accounts (CIN-AZ) include both. This is a semantic variation inside the crosswalk table, not a structural deviation from the spec template (which shows the crosswalk shape but leaves system-column content per-account).
- **§2 sub-structure** varies by shape: some accounts have §2d ancillary populated (CIN-AZ, TBR-FL BGC, TXR-V catering); others have "NONE" (CIN-KY, STL-MO, TXR-AZ). Some have §2f tax as a distinct sub-section (TBJ-FL, TBR-FL); most fold tax into §2a. TXR-V has 3 non-standard sub-sections (2c MTO, 2d always-free carve-in, 2e billing cadence+tax+fees) because it's per-team-catering, not contract-fee. These variations are within-spec accommodations, not violations.
- **TBJ-FL adds §2f** ("Tax") outside the strict 2a-2e template. TBR-FL adds §2f too. Not drift; a helpful sub-heading.
- **TXR-TX-V** is the outlier - `§2a-2f` deviate from the standard sub-labels because the account is structurally unique (per-team catering, menu-as-authority). The parent §0-§7 skeleton still holds.

**TPL conclusion:** the account-record TPL should be **one clean skeleton** (§0-§7) with per-account variability inside §0 crosswalk and §2 sub-shape. TXR-TX-V will need explicit accommodation in the spec (or its own variant marker), because its §2 sub-labels differ.

---

## §7. QUESTIONS FOR KEVIN

Grouped by category. Prime-directive-preserving: each is a question, not a proposed fix.

### Cut-line judgment calls

#### Q1: §0 crosswalk table row-content classification
The crosswalk in every account file is a two-column table. I classified §0 as MIX because *some* rows carry dollar figures (PG rate rows, Finance schedule §W) and *others* are pure identity mappings (primary key, aliases, ABR OneSheeter tab, contract folder). The cleanest port is to split the crosswalk row-by-row. **Question:** do you want the operator REF to keep a *reference* to PG price rows in §0 (as "PG has rate rows here - see billing REF") or to just drop those rows entirely and let the billing REF hold the whole PG crosswalk?

#### Q2: §5 CIN-KY classification (I flipped between reads)
On my first read of the CIN-KY §5 I called it CTX. On a re-read I noticed line 89's "Year-end reconciliation vs $186,462 estimate" carries a dollar figure - so I flipped it to MIX. This is the borderline case: a single $-line inside otherwise-context table. **Question:** at what threshold does a §5 flip from CTX to MIX for the split-line? One $ mention? Two? An SF/rate row?

#### Q3: TXR-TX-V §3 accommodation
TXR-TX-V §3 is genuinely mixed (§3a service model = CTX, §3b billing workflow = MNY-adjacent, §3c contact roster = CTX). The other 10 accounts' §3 is uniformly CTX. **Question:** does TXR-TX-V get its own operator/billing split rule (sub-section-level, not just section-level), or does the account-record TPL grow a §3 sub-structure that all 11 accounts adopt?

### Digest / TPL classification

#### Q4: Digest §D handling
Digest §D ("Cross-check flags") is a pointer-only section referring to LEDGER / EVIDENCE / CONFLICT_REGISTER - the frozen-forensic set. It doesn't carry billing content but it also doesn't carry operator-facing content. **Question:** at port time, does digest §D:
(a) get stripped (frozen-forensic references don't port),
(b) get converted to a "provenance" appendix at the bottom of the digest (breadcrumb-citation only), or
(c) stay as-is with the pointers preserved as unclickable references?

### Specimen wrapping / count caveat

#### Q5: Specimen-line-count vs. specimen-count
My §2 census reports **line** hits with $-figures. A single line can carry multiple specimen figures (e.g., "MLB $28.58, MiLB $14.29, Pre-Game Hot Snack $10.93, Regular Snack $5.89" is one line, four specimens). **Question:** for the `<NonCanonical>` wrapping pass do you want to wrap at the **line level** (simpler, coarser - the whole line becomes non-canonical) or at the **figure level** (more surgical, needs regex to isolate each `$`-bearing token)? Line-level is safe-by-default; figure-level preserves surrounding prose as canonical.

#### Q6: Rate-table wrapping
Most §2b rate tables are markdown tables of the form `| Service | Rate | ... |`. Wrapping every rate cell in `<NonCanonical>` inside a markdown table is possible but visually ugly. **Question:** wrap at the table-level (whole table becomes NonCanonical) or per-cell (surgical, preserves the operator-facing service name)?

### Ref-citation form (breadcrumb rule)

#### Q7: LEDGER-citation format at port
~421 inbound refs to LEDGER exist across port candidates. These will become provenance-section citations at port time. **Question:** what's the target format?
- (a) Prose citation: `[LEDGER §Q, A-14, 2026-07-14]`
- (b) Frontmatter-linked: register the LEDGER as a `related` doc in the frontmatter, then reference it in body prose with just `§Q A-14`.
- (c) An out-of-corpus provenance appendix at the bottom of every REF listing all frozen-forensic refs.

#### Q8: SC_MONEY_MODEL in-corpus decision
The SC_MONEY_MODEL is referenced ~47 times from port candidates and is Kevin's "money-mechanics under PB-009" target. **Question:** is SC_MONEY_MODEL a port candidate (becomes an in-corpus PB or REF under PB-009), or does it stay in `docs/` as external framework? The answer changes ~47 refs from breadcrumb-citations to live in-corpus links.

### Structural

#### Q9: Digest "already superseded" contracts
CONTRACT_DIGEST_CIN-KY / TXR-AZ / TXR-TX-H / TXR-TX-V all carry `SUPERSEDED` markers on prior-year contract inventory rows (§A). These are contract *documents* marked historical, not verbatim clauses that must not port. **Question:** at port time, do the SUPERSEDED contract rows in §A stay (as year-over-year historical trail) or drop (only operative-year row survives)?

#### Q10: Account-record TPL - single vs. two-variant
The TPL that Kevin's targeting is the `ACCOUNT_FILE_SPEC.md` skeleton. Given the TXR-TX-V outlier, the choice is one flexible skeleton or two variants (standard + catering). **Question:** one TPL with a "catering variant" note in §2, or two distinct TPLs?

### Genre-map fringe (carried from prior report)

#### Q11: Same as prior inventory report's Q1 - unclassified files
`NORTH_STAR.md`, `SCOPE.md`, `PRICE_AUDIT.md`, `reviews/*.md`. Do these port, stay in `docs/`, or become internal-only per the STD-004 governance? Restated for the finance/architecture pass rather than the sc-corpus pass.

---

## §8. Summary numbers

- **§1 split-line:** 11 accounts × 8 sections = 88 cells classified. 4 uniformly CTX (§1, §3 except TXR-V, §7). 2 uniformly MNY (§2, §6 except TXR-V). 3 mix-per-account (§0, §4, §5). Per-account cut-line rows: ~27 total mixed sections needing row-level scissors.
- **§2 specimen census:** 319 $-figure lines across 11 accounts + 200 across 12 digests = **519 specimen-figure lines total, 138 percentage lines**. 26 already-superseded specimens in accounts, 7 in digests. 0 REVERSED. All 33 supersession-tagged specimens live in `§6 History` blocks or carry inline `[superseded ...]` tags.
- **§3 duplication:** every fact-type × every source × every account is present. 2-doc port scope (account + digest as LIVING CANONICAL, evidence/matrix/money-model NOT ported per-account) is confirmed correct.
- **§4 cross-ref graph:** **~495 inbound refs** from port candidates into frozen-forensic targets. Dominated by LEDGER (~421). Every one becomes a provenance-section citation at port time, unless SC_MONEY_MODEL enters the corpus (Q8).
- **§5 digest structure:** 12/12 uniform on §A-§D. Verbatim contract text uniformly block-quoted (`>`), annotations uniformly outside the quote.
- **§6 TPL:** one clean §0-§7 skeleton covers 11 accounts. Within-section variability (§0 crosswalk, §2 sub-shape) is spec-anticipated; TXR-TX-V's §2 sub-labels are the only genuine deviation.

## §9. What this report is NOT

- Not a port plan.
- Not proposed cell-content edits.
- Not a re-transcription of specimen values (every figure named is a location, never a re-derived value).
- Not a classification of §4/§5 rows down to the individual row (that's the port-time step; this pass classifies at the section level).

_Report path: `docs/audits/SC_PRICING_SUMMIT_DATA_COLLECTION_V2_2026-07-17.md`._
