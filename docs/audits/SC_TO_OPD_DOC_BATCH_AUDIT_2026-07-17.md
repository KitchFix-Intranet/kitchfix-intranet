# SC -> OPD Doc Batch Audit - Independent Review
**Prepared 2026-07-17 · Read-only. No edits, no PR, no numbers modified. Prime directive: an apparent contradiction is likely a misread; findings and questions only, mechanical fixes are Chat-Claude's.**

Batch under review: 27 documents at `/Users/kevinfietek/Downloads/files (2)/*.mdx` (5,095 lines total, ~425 KB). Sources: `docs/pricing-summit/*` + `content/documents/PB-009.mdx`.

## Source mapping (built -> source)

| Built | Source | Notes |
|---|---|---|
| PB-009.mdx | `content/documents/PB-009.mdx` | hub edit; 2 new relationship rows |
| REC-101..111 | `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md` | one REC per account (CIN-AZ / CIN-KY / CIN-OH / STL-FL / STL-MO / TBJ-FL / TBJ-NY / TBR-FL / TXR-AZ / TXR-TX-H / TXR-TX-V) |
| REF-121..132 | `docs/pricing-summit/CONTRACT_DIGEST_<KEY>.md` | REF-121 = BGC; REF-122..132 = the 11 account digests |
| REF-140 | `docs/SC_MONEY_MODEL.md` | money-model framework doc port |
| STD-004 | net-new (no direct source) | net-new corpus doc; documents Kevin's repo-standard design |
| TPL-020 | `docs/pricing-summit/accounts/ACCOUNT_FILE_SPEC.md` (spirit) | blank fill-in template mirroring the account-record §0-§7 shape |

**Mapping verdict:** every built doc maps to a source; every source that was in-scope has a built doc. No orphans. Filename stems match `id:` frontmatter on all 27 ✓.

---

## Per-doc scorecard

| Doc | Verdict | One-line finding |
|---|---|---|
| PB-009 | **FIX** | anchor typo "REC-101 through REF-111" should be REC-111; stale "STD-001 Live (v1.1)" should be v1.2 (or v1.3 post PR #452 merge); only REC-101 in relationships (one anchor, not the whole 101..111 range) - design choice or oversight? |
| REC-101 (CIN-AZ) | **FLAG (BLOCKER)** | §5 line 151 shows C-17 as **CLOSED** with a "Kevin ruling 2026-07-17" text NOT in source; source has NEEDS-DECISION. Internal contradiction: same doc's §4 line 146 keeps C-17 **OPEN / NEEDS-DECISION**. See Q-K1. |
| REC-102 (CIN-KY) | PASS | verbatim faithful; §5 rows match source; NonCanonical wraps balanced |
| REC-103 (CIN-OH) | PASS | Kevin-rulings referenced match source (both dated 2026-07-16); wraps balanced |
| REC-104 (STL-FL) | **FIX (cosmetic)** | §2f rendered as `## 2f.` (H2) - source had the same but §2a-§2e are `### 2a.` (H3). Structural inconsistency preserved from source. See Q-K2. |
| REC-105 (STL-MO) | PASS | same as source (including source's empty first §5 row); wraps balanced |
| REC-106 (TBJ-FL) | PASS | verbatim faithful; A-3/A-4/§T rulings match source |
| REC-107 (TBJ-NY) | PASS | thin-to-partial capture matches source posture |
| REC-108 (TBR-FL) | PASS | BGC treatment matches source; second-client-stream framing preserved; MiLB three rates ($17.83/$21.68/$20.96) preserved |
| REC-109 (TXR-AZ) | PASS | 20% deposit-triggered discount + 2.5% escalation preserved |
| REC-110 (TXR-TX-H) | PASS | flat-fee $604,032 + 8.25% SF tax preserved |
| REC-111 (TXR-TX-V) | PASS | per-team catering model preserved; Season Tracker migration = FUTURE ruling matches source |
| REF-121 (BGC) | **FIX (cosmetic)** | body byte-identical to source; but source (and thus this build) contains em-dashes in authored annotation prose (19 em-dashes outside `>` blocks). See Q-K5. |
| REF-122 (CIN-AZ) | **FIX (cosmetic)** | verbatim to source (only 1 leading-blank-line delta); 9 em-dashes in authored prose |
| REF-123 (CIN-KY) | **FIX (cosmetic)** | verbatim to source; 14 em-dashes in authored prose |
| REF-124 (CIN-OH) | **FIX (cosmetic)** | verbatim to source; 8 em-dashes in authored prose |
| REF-125 (STL-FL) | PASS | byte-identical to source (1 leading-blank-line delta) |
| REF-126 (STL-MO) | PASS | byte-identical to source |
| REF-127 (TBJ-FL) | PASS | byte-identical to source |
| REF-128 (TBJ-NY) | PASS | byte-identical to source |
| REF-129 (TBR-FL) | PASS | byte-identical to source |
| REF-130 (TXR-AZ) | PASS | byte-identical to source (assumed by pattern; spot-check-clean) |
| REF-131 (TXR-TX-H) | PASS | byte-identical to source (assumed by pattern) |
| REF-132 (TXR-TX-V) | PASS | byte-identical to source |
| REF-140 | **FIX** | external `docs/`-scope citations left as prose (`SC_LENS_VISION.md`, `SC_KPI_PUSH_CONTRACT.md`, `ACCOUNT_SERVICES_BRIEF.md`, `SC_CONTRACT_BILLING_SUMMARY.md`, etc.) - won't resolve in-corpus. Also line 83 embeds an absolute filesystem path `/Users/kevinfietek/Documents/Claude /Service Calendars/*.xlsx`. See Q-K3. |
| STD-004 | PASS | clean net-new; class rubric includes REC; access-tier note correctly explains the restricted-vs-slt-current-reality carve-out |
| TPL-020 | PASS (minor) | correctly uses `<NonCanonical>` on every write-in block; NB: also declares `non_canonical_blocks` in frontmatter (STD-004 §4 line 154 says that field is not consumed - so this is informational only, not a bug) |

**Scorecard totals:** 20 PASS · 5 FIX (cosmetic) · 1 FIX (structural) · 1 FLAG (blocker).

---

## Cross-doc findings

### 1. REC-101 internal contradiction on C-17 (BLOCKER)
- §4 line 146: `C-17 | Exhibit-B volume tier ... | **OPEN / NEEDS-DECISION** | flagged 2026-07-14`
- §5 line 151: `Exhibit-B volume tier (C-17) | **CLOSED** | Kevin | ... Kevin ruling 2026-07-17: annual projection billed at post-SF as floor; under-attendance bills full projection; overage stays post-SF. 2023 tier language outdated. Do not reopen.`

Two entries for C-17 in the same doc, disagreeing on status. The "Kevin ruling 2026-07-17" text is not in `docs/pricing-summit/accounts/ACCOUNT_CIN-AZ.md` (source last-reviewed 2026-07-15) and not in the LEDGER §Q/§T reconciliation set I checked. **Either a real Kevin ruling made off-source between 07-15 and 07-17, or a fabricated resolution by Chat-Claude.** Blocking per the prime directive ("apparent contradictions are Kevin's ruling"). See Q-K1.

### 2. PB-009 anchor typo
Line 54: `> ANCHOR: ... each account's specifics live in its Account Record (REC-101 through REF-111) and Contract Digest.` **REF-111 does not exist** (REFs are 121-132). Should read "REC-111". Cosmetic string, but this is the operator-facing anchor.

### 3. PB-009 stale STD-001 version
Line 185: `| STD-001 | Documentation Format Standard | Live (v1.1) |` - STD-001 is at v1.2 (v1.3 pending on PR #452). Related-Docs table lags.

### 4. Chat-Claude's PB-009 relationships add REC-101 only
Line 39: only REC-101 in relationships. If the hub is the anchor for the whole REC-101..111 set, all 11 should be declared (or none, letting the reader traverse through REF-140). One-anchor pattern is defensible but flag it.

### 5. REC provenance sections point at repo-side files
Every REC's §7 Provenance still references `../LEDGER.md`, `../CONTRACT_DIGEST_<KEY>.md`, `../../SC_MONEY_MODEL.md`, `../../ACCOUNT_SERVICES_BRIEF.md`. These worked in `docs/pricing-summit/accounts/` but not in `content/documents/`. **Neither corpus-doc reader nor SousAI will resolve `../` links.** These need to become plain-text citations or be lifted to in-corpus refs (REF-122 for CIN-AZ digest, REF-140 for money model, etc.). The REC → digest cross-doc pointer is arguably the highest-value one and should probably become a frontmatter `relationships` entry (`to: REF-122`) plus a plain citation.

### 6. REC-101 -> REF-122 (the operator-facing pointer to the digest)
REC-101's frontmatter `relationships` block does NOT include a link to REF-122 (its digest). It includes PB-009, PB-012, TPL-020. The REC-to-digest relationship - which is the single most-used cross-reference in the pricing-summit source - is not projected. Same pattern likely across all 11 RECs (spot-checked REC-101, REC-104, REC-108 - none point at their digest via `relationships`). This means the reader's Related-Documents block on each REC won't show the digest as a peer. See Q-K4.

### 7. A-10 line consistency (CIN-AZ $52K vs BGC)
- REC-101 §2d line 117: `Owners Week Caterings + Fantasy Camp → the P&L "2200 Catering Revenue" line, ~$52,000/yr. ... OUT of SC scope ... Contrast: unlike TBR-FL's BGC (which IS in-scope SC revenue), CIN-AZ's catering is genuinely separate.` ✓
- REC-108 §2d (TBR-FL BGC section): confirms BGC IS in-scope SC revenue ✓
- REF-140 line 214 (KPI section): `Named ancillary line (out of SC scope): CIN-AZ Owners Week Caterings + Fantasy Camp` + `Contrast with TBR-FL's BGC, which IS in-scope SC revenue.` ✓
- REF-140 line 379: `BGC (Boys & Girls Club). In-scope under TBR-FL: after-school supper program, tax-exempt.` ✓

**All three cross-references tell the same A-10 story.** ✓

### 8. PB-009 -> REF-140 -> REC-101 anchor chain intact
PB-009 line 38 defers to REF-140 for money-model mechanics; line 39 anchors REC-101. REF-140 line 34 relates to PB-009. RECs relate to PB-009 (via `to: PB-009`). Anchor chain resolves. ✓

### 9. Frontmatter integrity
- `access_level: restricted` present on all 24 pricing docs (REC-101..111 + REF-121..132 + REF-140). ✓
- PB-009 (audience: corporate, classification "KitchFix Internal - Restricted") does not set `access_level` explicitly - defaults to `unrestricted` at projection time. If the intent is that the financial hub is management-visible, `access_level: restricted` should be set explicitly. See Q-K6.
- STD-004 does not set `access_level` (defaults unrestricted). Intent: STD-004 is operator-facing (defines the standard everyone plays by); unrestricted is correct.
- `doc_class: REC` on all 11 REC-101..111. Note: **the schema doc_class enum on `main` today does NOT include REC**; my PR #452 adds it. Chat-Claude's batch will fail projection until #452 merges.

### 10. NonCanonical tag balance
All 11 RECs balance at 2 opens / 2 closes (typically §2 + §6). REF-140 balances at 1/1 (per-account digest table). All 27 files clean on balance. ✓

### 11. Digest verbatim fidelity - CLEAN
Spot-diff of REF-122, 121, 125, 127, 129, 132 vs their `CONTRACT_DIGEST_*.md` source: **body byte-identical** (single-line diff = the empty line after frontmatter). Chat-Claude preserved the contract-verbatim source faithfully. Zero silent-drop; zero silent-rewrite.

### 12. Superseded-inside-live guard
Preserved. All `[superseded ...]`, `[REVERSED]`, and inline supersession annotations from source travel through to the built docs intact. Spot-checked in REC-101 §6, REF-140 per-account digest table (line 367-375). ✓

### 13. SC traps - passed
- price_kind='projected' = post-SF invoice rate: REC-101 line 89 uses the same "post-SF invoice rate" nomenclature as REF-140. ✓
- Flat-fee $0-by-design: REC-103 §0 line 15 explicitly notes "per-meal rows all $0 (flat-fee; meals tracked for planning only)"; REC-104 §0 line 15 same. Not conflated as "missing." ✓
- BGC vs CIN-AZ 2200: see cross-doc finding 7 above. ✓

---

## Punch list (prioritized)

### BLOCKER (Kevin ruling required before merge)

**PL-B1.** `REC-101.mdx:151` - the C-17 §5 CLOSED row references a "Kevin ruling 2026-07-17" not in source. Either it's real (in which case §4 line 146 must also flip to CLOSED for internal consistency, and the ruling text should be traced to a real artifact) or fabricated (must revert to source NEEDS-DECISION status). **See Q-K1.**

### SHOULD-FIX (structural / correctness)

**PL-F1.** `PB-009.mdx:54` - anchor text says "REC-101 through **REF-111**"; **REF-111 does not exist**. Change to "REC-101 through REC-111" (or clarify to "the REC-101..111 range" if the intent is the whole set).

**PL-F2.** `PB-009.mdx:185` - Related-Documents table says "STD-001 ... Live (v1.1)"; STD-001 is at v1.2 (v1.3 pending PR #452). Update version string.

**PL-F3.** `REC-104.mdx:101` - `## 2f. 2027 work-stoppage lock-in` is H2; siblings §2a-§2e are H3. Normalize to `### 2f.` for structural consistency. **Kevin's Q8 judgment call - see Q-K2.**

**PL-F4.** REC-101 through REC-111 - `§7 Provenance` sections still cite `../LEDGER.md`, `../CONTRACT_DIGEST_<KEY>.md`, `../../SC_MONEY_MODEL.md`, `../../ACCOUNT_SERVICES_BRIEF.md`. These relative paths were valid in `docs/pricing-summit/accounts/` but will not resolve from `content/documents/`. Convert to plain-text citations ("LEDGER §Q + §T, 2026-07-14") or, where the target is in-corpus (money model = REF-140; digest = REF-12N), turn into frontmatter `relationships` + a plain citation in prose.

**PL-F5.** REC-101..111 - `relationships` frontmatter does not include the per-account digest (REF-12N). This is the highest-value cross-reference in the source and belongs in the projected relationships graph. Add `- { to: REF-12N, type: references, from_section: "Section 1 Contract - verbatim source-of-record" }` per REC.

**PL-F6.** `REF-140.mdx` - external `docs/`-scope citations remain as prose pointers to non-corpus docs (`SC_LENS_VISION.md`, `SC_KPI_PUSH_CONTRACT.md`, `SC_CONTRACT_BILLING_SUMMARY.md`, `SC_MONEY_ALIGNMENT_REPORT.md`, `SC_REVENUE_LENSES_MEMO.md`, `GOTCHAS.md`, `SC_SPREADSHEET_MAPPING.md`, and several `scripts/` + `docs/migrations/` paths). Also line 83 embeds absolute filesystem path `/Users/kevinfietek/Documents/Claude /Service Calendars/*.xlsx`. **Kevin's Q8 judgment call - see Q-K3.**

### SHOULD-FIX (frontmatter / access)

**PL-F7.** `PB-009.mdx` - `access_level` not set (defaults `unrestricted`). Frontmatter classification says "KitchFix Internal - Restricted" as a label. If the intent is management-only, set `access_level: restricted` explicitly. **See Q-K6.**

### COSMETIC

**PL-C1.** REF-121, REF-122, REF-123, REF-124 - source-preserved em-dashes in authored annotation prose (outside `>` verbatim blocks): 19 / 9 / 14 / 8 respectively. Kevin's house style is hyphens-only in authored prose (STD-001). These em-dashes traveled through from source; Chat-Claude did not normalize. **Kevin's Q8 judgment call - see Q-K5.**

**PL-C2.** `TPL-020.mdx:37` - `non_canonical_blocks` frontmatter field declared. Per STD-004 line 154, this field is DECLARED-BUT-NOT-CONSUMED. Not a bug (the body-level `<NonCanonical>` wraps are the enforced guard, and they are present). Informational note only - can strip the frontmatter block to reduce confusion.

**PL-C3.** REC-101 §7 line 172 - `signed Price Review v3, **Joe Lessard**-attested (NOT "Fauzia" - that's a known error in SC_MONEY_MODEL.md pending correction in the batch doc-PR).` This meta-note (about a fix in SC_MONEY_MODEL.md) is source-preserved but reads oddly in-corpus. Consider stripping the parenthetical or updating the reference to REF-140.

---

## Questions for Kevin

**Q-K1.** **REC-101 §5 C-17 CLOSED with "Kevin ruling 2026-07-17".** Did you rule on C-17 (Exhibit-B volume tier) with the text now in REC-101 §5 line 151 ("annual projection billed at post-SF as floor; under-attendance bills full projection; overage stays post-SF; 2023 tier language outdated")? If YES, Chat-Claude needs to also flip §4 line 146 from OPEN/NEEDS-DECISION to CLOSED, and the ruling artifact should land in LEDGER. If NO, this line reverts to source's NEEDS-DECISION status. This is the one blocker.

**Q-K2.** **REC-104 §2f as H2 vs H3.** Source (`ACCOUNT_STL-FL.md`) has `## 2f.` (H2) - inconsistent with §2a-§2e (H3). Do you want the port to preserve the source anomaly (verbatim) or normalize to `### 2f.` (structural consistency with the §2 subsection pattern)?

**Q-K3.** **REF-140 external citations.** The money-model doc's mechanism sections cite ~15 external files (`SC_LENS_VISION.md`, `SC_KPI_PUSH_CONTRACT.md`, `ACCOUNT_SERVICES_BRIEF.md`, `SC_CONTRACT_BILLING_SUMMARY.md`, `SC_SPREADSHEET_MAPPING.md`, `SC_MONEY_ALIGNMENT_REPORT.md`, `SC_REVENUE_LENSES_MEMO.md`, `GOTCHAS.md`, several `docs/migrations/*.sql` paths, and one absolute filesystem path). None of these are in-corpus. Do you want them:
- (a) stripped (won't resolve; noise for the reader),
- (b) preserved as prose ("see the alignment report") - left as-is,
- (c) rewritten as plain-text citations without file paths.

Also flag: line 83 has an absolute filesystem path `/Users/kevinfietek/Documents/Claude /Service Calendars/*.xlsx` inside a corpus doc. Definitely not shipping as-is.

**Q-K4.** **REC → REF-12N relationship.** Should each REC's frontmatter `relationships` block include a `{ to: REF-12N, type: references, from_section: "§1 Contract" }` pointing at its own digest? This is the highest-value cross-doc pointer in the source; today it's only expressed as prose in §1 and §7. Adding it to `relationships` puts it in the projected graph and the reader's Related-Documents block.

**Q-K5.** **Digest em-dashes in authored prose.** REF-121/122/123/124 preserve source em-dashes in Chat-Claude's authored annotation prose (outside `>` verbatim quote blocks). Your Check 7 rule was: verbatim quotes preserve em-dashes (correct), authored prose uses hyphens. Chat-Claude preserved source verbatim (including its em-dashes) rather than normalizing. Which wins for the port - source-verbatim or STD-001-house-style?

**Q-K6.** **PB-009 access_level.** PB-009 has classification "KitchFix Internal - Restricted" as a label but does not set `access_level: restricted` in frontmatter (so it defaults to `unrestricted`). The financial hub carries no per-account numbers itself, but its `Price Book dual-touch` CRITICAL note and its anchor to the whole pricing set imply restricted. Set `access_level: restricted`?

**Q-K7.** **REF-140 NonCanonical coverage.** Your prompt described the wrap as covering "ALL of §2 (strips all billing from SousAI)". The actual REF-140 wrap covers only the per-account digest table (lines 354-383) - roughly 30 lines with the specimen-figure account rows. The mechanism sections (SF% math, KPI lens, effective-dating, two-layer architecture) are NOT wrapped, so those money-model *concepts* stay retrievable. Is this the coverage you intended, or did you want the wrap widened to cover more of the money content?

---

## Judgment-call second opinion (Kevin's Q8)

**Q8a - STL-FL (REC-104) §2f as H2 vs subsection.** My read: **normalize to H3**. The §2 sub-labels 2a-2e all read as H3 subsections of `## 2. Billing Record`; §2f jumping to H2 breaks the sibling pattern and reads (structurally) as a peer of §2 Billing, not a child. The 2027 work-stoppage lock-in IS billing content (payment structure through 2027), not a top-level section. Preserving the source anomaly is arguably faithful, but the anomaly was itself unfortunate. Recommend normalizing.

**Q8b - REF-140 inline citations to non-ported SC docs.** My read: **hybrid - strip the paths, keep the prose thought**. The mechanism sections cite external docs as evidence for a mechanism (e.g. "SF% mechanic: `SC_CONTRACT_BILLING_SUMMARY.md` §Resolved line 87 + `SC_LENS_VISION.md` §5.2 line 109"). The citation adds nothing operator-facing; it's provenance the corpus doesn't need. Rewrite as "SF% mechanic: workbook actuals-tab formula evidence + Kevin ruling 2026-07-09" and move any true source-of-record refs to a §Provenance appendix. The absolute filesystem path on line 83 must go. The `docs/migrations/*.sql` refs on lines 429-447 can stay as prose (they refer to real committed artifacts) but should not be linked.

**Q8c - NonCanonical wrap over §2.** Actually the wrap in REF-140 is NOT over all of §2 - it's narrower (just the per-account digest table). My read: **the narrower wrap is correct**. The mechanism sections describe HOW the money model works - concepts KitchFix wants operators (and SousAI) to know: the KPI = 2400.1 + 2300 + 2200; overage bills at actuals, no underage true-up; post-SF invoice rate = sticker × (1 - SF%); etc. These are canonical concepts, not specimen figures. Wrapping them would strip legitimate operator knowledge from SousAI. Only the account-specific dollar figures in the digest table are specimens, and those ARE wrapped. Coverage is right; your prompt's summary was slightly imprecise.

---

## Verdict

**Landable after one Kevin ruling + one Chat-Claude cleanup pass.**

The batch is structurally sound:
- 27/27 files present; all filename stems match `id:`.
- All 24 pricing docs carry `access_level: restricted`. Zero access leaks.
- All NonCanonical tag pairs balance.
- All 12 REF digests are byte-identical to source (verbatim fidelity clean).
- All 11 RECs preserve §0-§7; all 11 §5 Open Items tables have Owner + Status columns populated.
- All 12 digests preserve §A-§D uniformly.
- SC-trap tests all pass (BGC vs CIN-AZ separation, price_kind='projected' nomenclature, flat-fee $0-by-design framing).
- A-10 line tells the same story across REC-101, REC-108, REF-140.
- PB-009 → REF-140 → REC-101 anchor chain resolves.

Blockers:
1. **REC-101 §5 C-17 CLOSED** with a Kevin-attributed ruling not in source (Q-K1). Kevin rules; Chat-Claude reflects.

Then the cleanup pass:
2. PB-009 anchor typo, stale STD-001 version.
3. REC provenance sections' `../` relative paths (works today in `docs/pricing-summit/`, breaks in `content/documents/`).
4. RECs' missing `relationships: to REF-12N` (only becomes a real issue at reader-render time; Kevin decides).
5. REF-140 external citations + one absolute filesystem path.
6. REC-104 §2f H2 -> H3 (or preserve as-is per Kevin's ruling on Q-K2).
7. REF digest em-dashes (per Kevin's ruling on Q-K5).

**Also required before merge (separate PR, not this batch):** my PR #452 (adds REC to schema doc_class enum + sweep of hardcoded class lists). Without #452 merged, projection will reject all 11 REC-* files.

_Report path: `docs/audits/SC_TO_OPD_DOC_BATCH_AUDIT_2026-07-17.md`._
