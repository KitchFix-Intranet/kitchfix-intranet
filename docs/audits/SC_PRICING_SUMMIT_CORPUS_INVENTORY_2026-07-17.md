# SC Pricing-Summit Corpus - Full Mechanical Inventory
**Prepared 2026-07-17 · Read-only investigation, no edits, no PR. Cataloging + measuring the ratified, finance-verified, Kevin-ruled corpus.**

Scope: everything under `docs/pricing-summit/`. Prime directive honored: no rewriting, no re-deriving figures, no "resolving" apparent contradictions. Anything ambiguous surfaces as a question in §7, not a fix.

Sourcing: file reads + greps only. No PG queries, no external systems touched.

---

## §1. File inventory (47 files, ~776 KB total)

Genre column classification per Kevin's briefing (LIVING CANONICAL = port candidate; FROZEN FORENSIC = never port; FRAMEWORK / WIP / TRACKING / GENERATED per the map). Files flagged with `?` don't map cleanly - see §7 Q1.

### `docs/pricing-summit/` (root)

| File | Lines | Bytes | Genre |
|---|---:|---:|---|
| README.md | 41 | 3,801 | LIVING CANONICAL |
| NORTH_STAR.md | 80 | 6,873 | FRAMEWORK? (see Q1) |
| SCOPE.md | 60 | 8,953 | FROZEN FORENSIC? (README §What's here calls it "historical") |
| LEDGER.md | 1,211 | 170,589 | FROZEN FORENSIC (narrative sections A-P) + LIVING (§Q current dispositions) |
| CONFLICT_REGISTER.md | 659 | 50,973 | FROZEN FORENSIC (self-declared SUPERSEDED banner at line 7) |
| BILLING_TERMS_MATRIX.md | 148 | 11,868 | FRAMEWORK |
| PL_2026_APPENDIX.md | 305 | 23,301 | FROZEN FORENSIC (evidence appendix) |
| PG_APPENDIX.md | 196 | 15,238 | FROZEN FORENSIC (evidence appendix) |
| PRICE_AUDIT.md | 190 | 11,663 | FROZEN FORENSIC (evidence appendix) |
| CONTRACT_DIGEST_BGC.md | 189 | 13,600 | LIVING CANONICAL |
| CONTRACT_DIGEST_CIN-AZ.md | 160 | 12,663 | LIVING CANONICAL |
| CONTRACT_DIGEST_CIN-KY.md | 166 | 12,493 | LIVING CANONICAL |
| CONTRACT_DIGEST_CIN-OH.md | 194 | 15,842 | LIVING CANONICAL |
| CONTRACT_DIGEST_STL-FL.md | 168 | 14,501 | LIVING CANONICAL |
| CONTRACT_DIGEST_STL-MO.md | 159 | 12,250 | LIVING CANONICAL |
| CONTRACT_DIGEST_TBJ-FL.md | 163 | 19,181 | LIVING CANONICAL |
| CONTRACT_DIGEST_TBJ-NY.md | 129 | 12,256 | LIVING CANONICAL |
| CONTRACT_DIGEST_TBR-FL.md | 181 | 20,603 | LIVING CANONICAL |
| CONTRACT_DIGEST_TXR-AZ.md | 143 | 11,755 | LIVING CANONICAL |
| CONTRACT_DIGEST_TXR-TX-H.md | 159 | 12,306 | LIVING CANONICAL |
| CONTRACT_DIGEST_TXR-TX-V.md | 93 | 6,387 | LIVING CANONICAL |
| EVIDENCE_CIN-AZ.md | 227 | 15,696 | FROZEN FORENSIC |
| EVIDENCE_CIN-KY.md | 139 | 8,071 | FROZEN FORENSIC |
| EVIDENCE_CIN-OH.md | 136 | 10,728 | FROZEN FORENSIC |
| EVIDENCE_STL-FL.md | 154 | 10,979 | FROZEN FORENSIC |
| EVIDENCE_STL-MO.md | 126 | 7,598 | FROZEN FORENSIC |
| EVIDENCE_TBJ-FL.md | 166 | 14,835 | FROZEN FORENSIC |
| EVIDENCE_TBJ-NY.md | 67 | 2,669 | FROZEN FORENSIC |
| EVIDENCE_TBR-FL.md | 208 | 16,349 | FROZEN FORENSIC |
| EVIDENCE_TXR-AZ.md | 211 | 12,148 | FROZEN FORENSIC |
| EVIDENCE_TXR-TX-H.md | 141 | 7,901 | FROZEN FORENSIC |
| EVIDENCE_TXR-TX-V.md | 96 | 5,816 | FROZEN FORENSIC |

### `docs/pricing-summit/accounts/`

| File | Lines | Bytes | Genre |
|---|---:|---:|---|
| ACCOUNT_FILE_SPEC.md | 116 | 7,288 | FRAMEWORK (spec/template) |
| ACCOUNT_CIN-AZ.md | 128 | 19,160 | LIVING CANONICAL (pilot) |
| ACCOUNT_CIN-KY.md | 109 | 14,060 | LIVING CANONICAL |
| ACCOUNT_CIN-OH.md | 107 | 13,335 | LIVING CANONICAL |
| ACCOUNT_STL-FL.md | 110 | 14,015 | LIVING CANONICAL |
| ACCOUNT_STL-MO.md | 111 | 12,412 | LIVING CANONICAL |
| ACCOUNT_TBJ-FL.md | 116 | 14,939 | LIVING CANONICAL |
| ACCOUNT_TBJ-NY.md | 102 | 14,128 | LIVING CANONICAL |
| ACCOUNT_TBR-FL.md | 136 | 19,742 | LIVING CANONICAL |
| ACCOUNT_TXR-AZ.md | 105 | 12,254 | LIVING CANONICAL |
| ACCOUNT_TXR-TX-H.md | 95 | 10,247 | LIVING CANONICAL |
| ACCOUNT_TXR-TX-V.md | 139 | 18,376 | LIVING CANONICAL |

### `docs/pricing-summit/questions/`

| File | Lines | Bytes | Genre |
|---|---:|---:|---|
| JOE_QUESTIONS.md | 39 | 3,312 | TRACKING |
| SEBASTIAN_QUESTIONS.md | 17 | 1,633 | TRACKING |

### `docs/pricing-summit/reviews/`

| File | Lines | Bytes | Genre |
|---|---:|---:|---|
| ABR_ONESHEETER_REVIEW.md | 128 | 15,177 | FROZEN FORENSIC? (see Q1) |
| CONTRACT_DIGEST_REVIEW.md | 70 | 6,399 | FROZEN FORENSIC? (see Q1) |

### Structural expectation vs. reality

| Expected (per briefing) | Found | Status |
|---|---|---|
| 11 accounts | 11 (`ACCOUNT_*.md` under `accounts/`) | ✓ |
| 12 digests (BGC extra) | 12 (`CONTRACT_DIGEST_*.md`) | ✓ |
| 11 evidence | 11 (`EVIDENCE_*.md`; no BGC by design) | ✓ |
| 12 account-folder files | 12 (11 accounts + `ACCOUNT_FILE_SPEC.md`) | ✓ |
| Generated `PRICE_BOOK` | not present | ✓ ("does not exist yet") |
| `SC_MONEY_MODEL.md` FRAMEWORK | in `docs/` not `docs/pricing-summit/` | ✓ (per briefing note) |

**Flags on unexpected files (not classified in the briefing's genre map):**
- `NORTH_STAR.md`, `SCOPE.md`, `PRICE_AUDIT.md`, `reviews/ABR_ONESHEETER_REVIEW.md`, `reviews/CONTRACT_DIGEST_REVIEW.md` - see §7 Q1.

**Also observed (briefing didn't mention):** README.md line 26 lists digests as "×11", but 12 are present (BGC is the extra, as briefing correctly noted). The README wording is stale. See §7 Q2.

---

## §2. Account-file structure audit

All 11 `accounts/ACCOUNT_*.md` files follow `ACCOUNT_FILE_SPEC.md` exactly. Every file has the full §0-§7 heading set in order:

| Account | §0 | §1 | §2 | §3 | §4 | §5 | §6 | §7 | §5 Owner col | §5 rows |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| CIN-AZ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| CIN-KY | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 |
| CIN-OH | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| STL-FL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| STL-MO | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2 |
| TBJ-FL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| TBJ-NY | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| TBR-FL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8 |
| TXR-AZ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| TXR-TX-H | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5 |
| TXR-TX-V | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 |

- **Section headings:** exact spec labels (`## 0. IDENTITY & ALIASES`, `## 1. CONTRACT`, `## 2. BILLING RECORD`, `## 3. OPERATIONS RECORD`, `## 4. RULINGS & DECISIONS`, `## 5. OPEN ITEMS`, `## 6. HISTORY`, `## 7. PROVENANCE & ATTRIBUTION KEY`) present in all 11.
- **§5 Owner column:** every file has `| Owner |` in the §5 table header. Owner names populated in every §5 row (spot-checked: "Kevin", "Joe", "Sebastian", "Ashley" appear as owners; no rows found without a named owner).
- **§2 references PG / PRICE_BOOK / signed sheet vs. inlined figures:** every §2 crosswalks to `PG sc_service_prices` (all 11) and cites `signed Price Review v3` / finance §W / digest §refs as source per row. All 11 also inline rate-table numbers (per spec §2b template) - this is the spec's design, not a deviation. `PRICE_BOOK` (the future generated artifact) is not referenced anywhere because it doesn't exist yet.
- **Spec conformance:** no deviations from `ACCOUNT_FILE_SPEC.md` detected. Structure is uniformly clean.

**No structural anomalies found in this pass.** Numbers not extracted per prime directive.

---

## §3. Annotation / supersession index

Two annotation patterns scanned across the corpus:
- `[REVERSED...]` — later-ruling overrides.
- `[superseded...]` / `superseded` (case-insensitive) — value/framing that history preserves but current-truth replaces.

### `[REVERSED]` annotations (3 occurrences, all in LEDGER)

| File | Line | Annotation (verbatim excerpt) |
|---|---:|---|
| `LEDGER.md` | 233 | `A-9 GOTCHAS STL - FL P1 wrong ... → D-3 [REVERSED 2026-07-17 — see CONFLICT_REGISTER A-9; GOTCHAS was right, appendix R25 was the artifact]` |
| `LEDGER.md` | 480 | `A-9 / D-3 → GOTCHAS stale ... [REVERSED 2026-07-17 — see CONFLICT_REGISTER A-9; GOTCHAS was right, appendix R25 was the artifact]` |
| `LEDGER.md` | 495 | `D-3 GOTCHAS fix [REVERSED 2026-07-17 — see CONFLICT_REGISTER A-9; GOTCHAS was right, appendix R25 was the artifact]` |

### Supersession annotations (37 occurrences; the load-bearing set below)

Full list is grep-reproducible: `grep -rniE "superseded|supersede" docs/pricing-summit/`. The high-signal set (LIVING CANONICAL + FRAMEWORK; excludes contract-clause internal `supersedes all prior agreements` text and the spec's own template examples):

| File | Line | Nature |
|---|---:|---|
| `README.md` | 19 | "superseded facts move to each file's History block (marked, never deleted)" (design principle) |
| `SCOPE.md` | 11 | "P-5 Workbooks (Jul 9) presumed current until you say superseded" |
| `CONFLICT_REGISTER.md` | 7 | Whole-file self-declared **STATUS SUPERSEDED** banner - "read this first" |
| `CONFLICT_REGISTER.md` | 144 | A-1: "Superseded by the PG-vs-signed audit at `docs/pricing-summit/PRICE_AUDIT.md`" |
| `CONFLICT_REGISTER.md` | 170 | "$20.56 contract-derived rate ... superseded by P-1 (signed sheet)" |
| `LEDGER.md` | 7 | "sections T–U are the final rulings that supersede earlier framing" (design principle) |
| `LEDGER.md` | 11 | "earlier sections may show these as OPEN — that framing is superseded" |
| `LEDGER.md` | 245 | "$21.68 SUPERSEDES the contract's CPI-escalation clause" |
| `LEDGER.md` | 285 | ⚠️ **SUPERSEDED by §T (2026-07-15)**: the FSL/FCL "blend" premise is WRONG (in-line supersession banner) |
| `LEDGER.md` | 664 | "`ACCOUNT_SERVICES_BRIEF.md` (2026-06-16) carries pre-summit framing that our rulings supersede" |
| `LEDGER.md` | 764 | "STL-MO FIGURE — RESOLUTION UPDATED (supersedes my earlier $473K note)" |
| `LEDGER.md` | 842 | "MONEY_MODEL 2026 fee figures now superseded by finance §W: STL-MO, TBJ-FL, CIN-OH. Annotate." |
| `LEDGER.md` | 860 | "STL-FL upkeep ... supersedes the MONEY_MODEL 'KitchFix-borne' reading" |
| `LEDGER.md` | 1160 | "contract's $452,812 is simply OUTDATED, not a mystery +13.89% escalation" |
| `LEDGER.md` | 1162 | "SF cadence: 3× $171,904 Jan/Feb/Mar ... supersedes the OneSheeter-sourced tag" |
| `ACCOUNT_TBJ-FL.md` | 36 | "Contract's $452,812 base is OUTDATED/superseded (finance is the authority)" |
| `ACCOUNT_TBJ-FL.md` | 83 | "Contract $452,812 = outdated/superseded. NOT an escalation to reconcile" (§4 ruling row) |
| `ACCOUNT_TBJ-FL.md` | 100 | §6 History entry: "Contract SF base $452,812 ... SUPERSEDED by the negotiated 2026 billable $515,712" |
| `ACCOUNT_TBJ-NY.md` | 52 | "The 2019 draft rate was $18.75 (superseded)" |
| `ACCOUNT_CIN-OH.md` | 94 | §6 History: "2025 Services Fee = $357,500 (superseded by 2026 $376,686)" |
| `ACCOUNT_CIN-OH.md` | 102 | §2 note: "MONEY_MODEL's fee figure ($362,500 base) is superseded by finance's escalated $376,686 — pending batch-doc-PR annotation" |
| `ACCOUNT_STL-FL.md` | 52 | "Upkeep ruling ... supersedes the earlier MONEY_MODEL 'KitchFix-borne' reading" |
| `ACCOUNT_STL-MO.md` | 41 | "`§W — supersedes the earlier $473K-is-operative note`" |
| `ACCOUNT_STL-MO.md` | 106 | §2 note: "MONEY_MODEL's $473K figure is the base; superseded for 2026 billing by finance's $489,497 — pending batch-doc-PR annotation" |
| `ACCOUNT_CIN-KY.md` | 95 | §6 History: prior-year per-meal rates superseded by year-to-year renegotiation |
| `ACCOUNT_CIN-KY.md` | 96 | §6 History: prior guarantee structure "superseded 2026" |
| `ACCOUNT_TXR-AZ.md` | 19 | Contract-folder crosswalk: 2022 agreement (superseded) |
| `ACCOUNT_TXR-AZ.md` | 94 | §6 History: 2022 agreement (superseded — Initial Term ended Dec 31, 2024) |
| `ACCOUNT_TXR-TX-H.md` | 80 | §6 History: 2024 → 2025 → 2026 fee sequence, prior years marked superseded |

**Additional `[SUPERSEDED]` labels in digest contract-inventory tables** (contract-status column, not annotation-truth): `CONTRACT_DIGEST_CIN-KY.md:10-11`, `CONTRACT_DIGEST_TXR-AZ.md:10`, `CONTRACT_DIGEST_TXR-TX-H.md:10-11`, `CONTRACT_DIGEST_TXR-TX-V.md:12-13`, `EVIDENCE_TXR-AZ.md:10`. These are labeling the *contract document* as superseded (natural language) — not the corpus-annotation pattern.

**Pattern observed for the port:** the "annotation is truth" trap is real and well-marked. Two live shapes to preserve:
1. **In-line banner** (e.g., LEDGER §285) — a superseded-by callout inside a preserved section; the section text below is history, the banner is current.
2. **In-line square-bracket tag** (e.g., `[§W — supersedes the earlier $473K-is-operative note]`) — the tag is current; the text it annotates is history.

Both patterns must survive any port intact.

---

## §4. Cross-reference graph

Every `.md` inter-doc reference within `docs/pricing-summit/` was extracted. Full edge list is grep-reproducible: `grep -rnE '\.md[)\`\s]|LEDGER §[A-Z]|CONTRACT_DIGEST_|EVIDENCE_|ACCOUNT_[A-Z]' docs/pricing-summit/`. Summary of edge patterns:

### Edge patterns

| Source genre → Target genre | Common? | Direction |
|---|:-:|---|
| ACCOUNT → LEDGER | 11/11 files reference `../LEDGER.md` | outbound to FROZEN FORENSIC (§7 Q3) |
| ACCOUNT → CONTRACT_DIGEST | 11/11 files reference `../CONTRACT_DIGEST_<KEY>.md` | outbound to LIVING CANONICAL - clean |
| ACCOUNT → SC_MONEY_MODEL | Multiple (CIN-OH, STL-MO, others) reference `../../SC_MONEY_MODEL.md` | outbound to FRAMEWORK (external `docs/`) - clean |
| ACCOUNT → CONFLICT_REGISTER | Several reference `CONFLICT_REGISTER A-X` or file directly | outbound to FROZEN FORENSIC (§7 Q3) |
| CONTRACT_DIGEST → LEDGER | Yes (contract clauses tagged with LEDGER §refs) | outbound to FROZEN FORENSIC (§7 Q3) |
| CONTRACT_DIGEST → EVIDENCE | Digest-review corpus references EVIDENCE_<KEY>.md | outbound to FROZEN FORENSIC (§7 Q3) |
| EVIDENCE → SC_MONEY_MODEL | Multiple ("Q6 (SC_MONEY_MODEL)...") | fine (evidence is FROZEN, no port concern) |
| CONFLICT_REGISTER → EVIDENCE | Extensively | intra-forensic - no port concern |
| LEDGER → CONFLICT_REGISTER | The three `[REVERSED]` annotations at 233/480/495 | intra-forensic, but note: annotations tell port to preserve the reverse-pointer |
| README → various | Roster / points to authorities | outbound - many are LIVING or FRAMEWORK |
| Everything → SC_MONEY_MODEL / SC_CONTRACT_BILLING_SUMMARY / ACCOUNT_SERVICES_BRIEF | Yes | outbound to external docs (`docs/`) — see §5 overlap |

### Port-candidate references INTO frozen-forensic (flags for port-time handling)

The 11 ACCOUNT files and the 12 CONTRACT_DIGEST files (LIVING CANONICAL, port candidates) reference the following FROZEN files:
- `../LEDGER.md` and `LEDGER §Q`, `LEDGER §T-U`, `LEDGER §W`, `LEDGER §X` (in-file section refs) — 11/11 account files.
- `CONFLICT_REGISTER` and `CONFLICT_REGISTER A-#` refs — several files.
- `EVIDENCE_<KEY>.md §#` — digests + reviews.

**At port time:** these frozen refs will need either (a) rewriting to a port-time equivalent (a "history at commit" link), (b) preserved as dead-but-informative pointers, or (c) resolved into inline callouts. Not a decision this pass; noting the port scale: **~40+ cross-file refs into frozen-forensic**.

### Dangling references

None found via grep on file names actually referenced. All `../CONTRACT_DIGEST_<KEY>.md` and `../../SC_MONEY_MODEL.md` targets resolve. No 404-style refs detected in the sample scan. (Not exhaustive; would need a link-checker for full coverage — see §7 Q4.)

---

## §5. OPD-corpus overlap matrix

Compared SC pricing-summit subject matter against the 6 OPD docs Kevin named + `docs/ACCOUNT_SERVICES_BRIEF.md`. Topic-level only, no content extraction.

| SC pricing-summit surface | OPD doc | Overlap | Direction |
|---|---|---|---|
| `NORTH_STAR.md` (billing certification charter, 6 layers) | none of the OPD 6 | LOW | SC-specific concept; no OPD equivalent. |
| `SC_MONEY_MODEL.md` (external framework) - two billing models, SF asymmetry, KPI target | **PB-009** (Financial Ops Manual - "two contract models (fee vs full-service)") | **HIGH** at topic level | PB-009 is operator-facing on billing model; MONEY_MODEL is the settled technical model. Both cover "the two shapes." Dedupe question. |
| `ACCOUNT_FILE_SPEC.md` (per-account record template §0-§7) | **TPL-014** (SLA Template blank fill-in) | MODERATE — same "template + per-account fill" pattern but different scope | TPL-014 = KitchFix↔Client SLA structure; ACCOUNT_FILE_SPEC = internal per-account record. Different documents, related concept. |
| `accounts/ACCOUNT_*.md` (11 per-account records) | **PB-012** (Client & Account Mgmt Playbook - "how we keep accounts") | LOW at content level, MODERATE at concept level | PB-012 = playbook for account management practice; ACCOUNT_*.md = per-account authoritative record. Different consumers. |
| `accounts/ACCOUNT_*.md` (11 per-account records) | **`docs/ACCOUNT_SERVICES_BRIEF.md`** (cross-account roster) | **HIGH — flagged by briefing** | Confirmed. BRIEF already carries a self-declared supersession banner (2026-07-16): "Per-account billing / pricing / contract truth now lives in `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md`... Where this doc and an account file disagree, **the account file wins.**" Dedupe path is already declared: BRIEF stays as roster + operational context; ACCOUNT files are authority per-account. |
| `CONTRACT_DIGEST_*.md` (contract source-of-record) | none of the OPD 6 directly | LOW | Contract digests are commercial-confidential source-of-record; no OPD equivalent. |
| SLA structural framework (implicit in SC via ACCOUNT files' commercial-terms sections) | **PB-005** (SLA OS Handbook) + **TPL-014** | MODERATE at concept level | PB-005 = 10-section SLA framework. ACCOUNT files don't restate SLA structure - they record per-account billing/ops truth. Overlap is small; PB-005 sits upstream. |
| Fictional SLA worked examples | **REF-005-A / REF-005-B** (Retired in this same session) | NONE - Retired | These were retired earlier this session. Not a live overlap. |

**Explicit ACCOUNT_SERVICES_BRIEF dedupe status (from the BRIEF's own banner):**
- ✅ Per-account truth → `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md` (declared authority)
- ✅ Cross-account roster + operational context → BRIEF (retained purpose)
- ✅ Money-model claims → SC_MONEY_MODEL.md (declared authority)
- The BRIEF states line 33 was rewritten to match the settled model; "older sections may still reflect the pre-2026-06-16 framing and will be trued up per-section in a follow-up" - not fully deduped yet.

---

## §6. `in_corpus` / sensitivity first-pass (mechanical inventory)

Scanned every port-candidate for existing YAML frontmatter, classification banners, or explicit sensitivity declarations. Findings are strictly what is THERE, no new tiers proposed.

| File | YAML frontmatter | Top-of-file banner | Explicit classification tag | Notes |
|---|:-:|:-:|:-:|---|
| README.md | none | none | none | Header prose only. |
| accounts/ACCOUNT_*.md (all 11) | **none** | ⚠️ blockquote banner on some (TBJ-FL, TBR-FL) | none | The spec template's §7 provenance block mentions "attested authority" but no classification tag. TBJ-FL's line-4 blockquote mentions "$515,712 in 2026" - **material commercial detail** but no metadata flag. |
| accounts/ACCOUNT_FILE_SPEC.md | none | none | none | Framework spec; no classification. |
| CONTRACT_DIGEST_*.md (all 12) | **none** | none | none | Contain verbatim contract text including confidentiality clauses (e.g., `CONTRACT_DIGEST_STL-MO.md:129`, `CONTRACT_DIGEST_CIN-OH.md:150` block-quote the contracts' own confidentiality provisions). No metadata declaring the digest itself confidential. |
| NORTH_STAR.md | none | none | none | Charter; no classification. |
| BILLING_TERMS_MATRIX.md | none | none | none | Framework matrix; no classification. |

**Nothing in the port-candidate set carries a formal `classification:` field, `access_level:`, `in_corpus:` frontmatter, or an explicit "Confidential"/"Restricted"/"Internal Only" banner in metadata form.** The only sensitivity signaling that exists today is:
1. Natural-language contract clauses inside CONTRACT_DIGEST files quoting the contract's own confidentiality obligations (e.g., MLB "except as required by MLB regulations", Reds "not to disclose Confidential Information").
2. The `ACCOUNT_FILE_SPEC.md` §7 note that "Prices: signed Price Review v3, Joe Lessard-attested" - attribution, not classification.
3. Spec template hints at commercial confidentiality by design intent, not by metadata.

**Design decision NOT made in this pass** (per prime directive). See §7 Q5.

---

## §7. QUESTIONS FOR KEVIN

Grouped by category. Each is a QUESTION, not a proposed fix.

### Sum-check flags (mechanical arithmetic on stated vectors)

#### Q-SUM-1: `PL_2026_APPENDIX.md` line 199-202 (TBJ-FL 2300 P&L 13-period)
Stated year total: **$515,712**.
Vector transcribed at line 199:
```
P1 76,755 · P2 117,894 · P3 43,840 · P4 39,175 · P5 39,238 · P6 35,252 ·
P7 44,104 · P8 25,169 · P9 33,994 · P10 22,115 · P11 14,217 · P12 5,265 · P13 (blank)
```
Sum of P1-P12: **$497,018**.
Delta vs stated year: **$18,694** (unaccounted).
Percentage claim at line 202 ("P1-P3 = 46.2% of the annual") is consistent with the stated year, NOT with the vector-sum.
**Question:** is P13 = $18,694 (the missing cell that closes to the stated year)? Or is the stated year the annualization target and the 12 non-blank cells the true recognized amount? The vector as written does not sum to its stated total. **Do not correct - Kevin rules.**

#### Q-SUM-2: `PL_2026_APPENDIX.md` line 178-186 (TBR-FL 2300 P&L 13-period)
Stated year total: **$457,768** (§Q1 answer).
Vector transcribed at line 180 has an in-line contradiction:
```
P4-P8 all $40,915 (identical 5 periods) · P7 $42,961 (small bump — either DH or 1-week seasonality)
```
P7 cannot be both `$40,915` (as one of the "identical 5") and `$42,961` (as the "small bump"). Sum of P1+P2+P3+P9+P10+P11+P12+P13 is $249,103. Adding "5 × $40,915" = $453,678 (delta $4,090 vs stated). Adding "4 × $40,915 + $42,961" = $455,724 (delta $2,044 vs stated). Neither matches.
**Question:** which interpretation of P7 is correct, and does the vector reconcile to $457,768 under either read? **Do not correct - Kevin rules.**

#### Q-SUM-3: `PL_2026_APPENDIX.md` line 78 (CIN-AZ P&L 2200 vector) - already flagged in the doc
```
only P1 + P2 show $3,000 each (=$6,000) but Year total $52,000; sum-of-periods delta = $46,000.
Kevin: this is either a hidden P13 value or a Year-column formula pulling from elsewhere.
Flag for verification with the accountant.
```
The doc already declares this a flag. Reporting it here so it is not lost.

#### Q-SUM-4 (verified match, reported for symmetry): `PL_2026_APPENDIX.md` line 210 (STL-FL 2400.1)
Vector `45,553 + 171,367 + 407,375 + 132,755 + 5×98,915 + 57,267 + 52,061 + 39,047 + 0` = **$1,400,000 EXACT**. Matches stated year. ✓ (No question - confirming clean vector; verified per prime directive.)

### Anomalies

#### Q1: Genre-map classification for files the briefing didn't classify
Briefing's genre map (per prompt) covered LIVING CANONICAL, FRAMEWORK, FROZEN FORENSIC, WIP, TRACKING, GENERATED. Not addressed:
- `NORTH_STAR.md` (certification charter, v1.1 ratified) - is this FRAMEWORK (like SC_MONEY_MODEL) or LIVING CANONICAL (the charter itself)?
- `SCOPE.md` (v1 scope proposal, ratified 2026-07-14; template lives elsewhere now per its own §3 note) - FROZEN FORENSIC given its "historical" characterization in README?
- `PRICE_AUDIT.md` (evidence appendix per README §What's here) - FROZEN FORENSIC?
- `reviews/ABR_ONESHEETER_REVIEW.md` and `reviews/CONTRACT_DIGEST_REVIEW.md` - FROZEN FORENSIC (consolidated point-in-time reviews)?

#### Q2: `README.md` line 26 mentions "CONTRACT_DIGEST × 11" but there are 12 files (BGC = 12th)
Structural fact per briefing is "12 digests (BGC extra)"; README wording lags. This is stale documentation, not a corpus defect. Preserving in report; no fix proposed.

#### Q3: Port-candidate references INTO frozen-forensic
All 11 ACCOUNT files, plus multiple CONTRACT_DIGEST files, reference `../LEDGER.md`, `LEDGER §Q/T/U/W`, `CONFLICT_REGISTER`, and per-account `EVIDENCE_*.md` refs. At port time these will need a strategy - preserve as pointers, rewrite to internal callouts, or capture as "history at commit" links? Not a decision this pass; scale is ~40+ cross-file refs.

#### Q4: Dangling references not exhaustively verified
This inventory did not run a full link-checker. Grep sample showed clean resolution for `.md` targets (`../CONTRACT_DIGEST_<KEY>.md`, `../../SC_MONEY_MODEL.md`). A full dead-link sweep may still surface stale refs (e.g., `docs/archive/SC_PRICE_COMPARISON.md` referenced by the BRIEF - the "archived" note suggests intentional archive, not a broken ref).

#### Q5: Sensitivity / classification metadata
No port-candidate today declares `classification`, `access_level`, `in_corpus`, or an equivalent metadata field. Every ACCOUNT + CONTRACT_DIGEST file materially embeds commercial-confidential detail (fees, per-meal rates, negotiated amounts, client-side stakeholders). Two decisions land at port time:
- **Sensitivity tier:** what classification tag every port-candidate gets (`"KitchFix Internal - Commercial Confidential"` matches the OPD REF-005-A pattern that was retired; is that the target?).
- **In-corpus decision:** which port candidates enter the Sous corpus (`in_corpus: true`) vs. are internal-only (`in_corpus: false`, like the retired REF-005-A/B).
**No new tiers assigned this pass per prime directive.**

#### Q6: `ACCOUNT_FILE_SPEC.md` classification at port
The spec is FRAMEWORK, but it lives inside `accounts/` alongside the account files. Does it port with the account records, stay in a framework location, or become an OPD STD-class doc?

### Dangling / structural

None found in the sampled scan. See Q4 for full-coverage caveat.

---

## §8. Summary numbers

- **Corpus size:** 47 files, 8,093 lines, 776,363 bytes (~776 KB).
- **Port-candidate count:** 11 accounts + 12 digests + README = **24 files** (plus `ACCOUNT_FILE_SPEC.md` as framework). See Q1 for the un-classified fringe.
- **Structural conformance:** 11/11 accounts pass the §0-§7 spec check clean; Owner column present in all 11 §5 tables; every referenced account file exists; digest count correct at 12.
- **Annotation load-bearing sites:** 3 `[REVERSED]` + ~15 core `superseded/[superseded → ...]` sites the port must preserve intact.
- **Cross-refs into frozen-forensic from port candidates:** ~40+ (Q3 - port-time decision needed).
- **Sensitivity metadata declared today:** zero (Q5 - joint decision at port time).
- **Sum-check flags:** 3 (Q-SUM-1, Q-SUM-2, Q-SUM-3); 1 clean vector (Q-SUM-4).

---

## §9. What this report is NOT

- Not a proposed port plan.
- Not a set of edits or fixes.
- Not a re-derivation of any figure - every number here is a transcription or an arithmetic sum of transcriptions, per Kevin's instruction.
- Not an authority read. Everything above is INVENTORY. Rulings on any anomaly stay with Kevin.

_Report path: `docs/audits/SC_PRICING_SUMMIT_CORPUS_INVENTORY_2026-07-17.md`._
