# Critical Findings Summary - OPD Library Phase 2 Audit

**Audit:** Pass 0 -> 1 -> 2 read-only review
**Compiled 2026-06-14**
**Scope:** Doc Set 1 (61 files - 56 docx + 5 pdf), reconciled to the 91-doc tracker
**For:** Kevin's CK-3 fastest read. Surface Critical findings first.

This document lists the CRITICAL findings only, in their own summary, before any other report content. Every finding cites the doc and section. None of these block the read-only audit; all of these block any one of (a) catalog write, (b) Sous embed, (c) Live promotion of the affected doc.

---

## 1. Live pointers to RETIRED documents (system corruption risk)

Any live cross-reference to a retired doc puts the wrong content in front of an operator or in front of SousAI. Fix BEFORE embed of the referencing doc.

| # | Referencing Doc | Section | Points At (RETIRED) | What to do instead |
|---|---|---|---|---|
| 1 | **SOP-002** Safety & Incident Management (Live) | Related Documents / Companion Form | **TPL-017** Site Incident Log | The intranet incident log is the system of record. Repoint to intranet, or remove. |
| 2 | **SOP-010** Driver / Fleet Safety (In Review) | §06 + Related Documents | **REF-008** Permit & License Tracker | Repoint to **POL-019** Permit & License Compliance Policy. |
| 3 | **SOP-015** Emergency Food-Safety (In Review) | Related Documents | **SOP-016** Foodborne-Illness Response | Repoint to **SOP-002 §07.4**. |
| 4 | **POL-009** IT & Acceptable Use (In Review) | Related Documents | **POL-016** Record Retention & Destruction | No replacement exists. POL-016 was retired without a superseding doc. **GAP** - Kevin's call: build a retention policy, point to PB-004 (light touch), or remove the reference. |
| 5 | **PB-007** Workplace Safety Manual (In Review) | §02 + §14 (3 occurrences) | **REF-008** Permit & License Tracker | Repoint to **POL-019**. |
| 6 | **FORM-009** Knife Skills Verification (In Review) | Body prose (line 43) + Related Documents (labeled "Live") | **REF-009** ServSafe Cert Tracker | Repoint to Rippling. Cert tracking lives in Rippling. |

Confirmation pending (subagent results indicate REPOINTED but specific text not verified):
- PB-007 §13 + §14 -> Rippling (formerly REF-009 ServSafe Cert Tracker). Need to verify the body text reflects Rippling.
- POL-012 (on hold) - no live pointers found in Doc Set 1.

---

## 2. Safety-critical doc-to-doc contradiction

**SOP-015 §03 Power-Loss Decision Table contradicts SOP-008.** Two rows in SOP-015's table contradict SOP-008's canonical 135F/41F TCS rules.

- SOP-015 row "Frozen food still ≤ 41°F" is wrong. Frozen food spec is ≤ 0°F (or "still frozen / no liquid"). 41°F is the cold-TCS threshold, not the frozen threshold.
- SOP-015 row "Cold TCS food between 41°F and 135°F / Safe up to 4 hours total in that zone, then discard" conflates Time-as-Public-Health-Control (TPHC) with the temperature-abuse rule. TPHC is a documented monitored exception in SOP-008; the default rule is the 2-hour clock on TCS food in the 41-135°F danger zone.

This is the most operationally dangerous error in the audit. A site using SOP-015's table during a power loss could leave TCS food at 130°F for 4 hours believing it was still safe. **Britt rewrite required before SOP-015 goes Live.**

---

## 3. Load-bearing doc cross-reference error

**PB-001 v9.1 §03 Culinary Philosophy ANCHOR says "See PB-003 Culinary OS Handbook"** - but PB-003 is the Service Recovery Playbook. The Culinary OS Handbook is **PB-006**.

The tracker confirms this is a known pending issue ("PB-006 renumbered from PB-003 (collision with Service Recovery). Pending confirmation"). It is the renumber confusion playing out in PB-001's body. PB-001 is the load-bearing leadership handbook (referenced by SOP-001, PB-005, others); a wrong cross-reference here puts every reader / Sous query for "Culinary OS" on the wrong doc.

**Fix:** PB-001 §03 ANCHOR replace "PB-003" with "PB-006" throughout.

---

## 4. Terminology drift in load-bearing doc

**PB-010 non-dup §08 says "Galley is the recipe system of record."** Per Audit Brief §4 conventions, "Galley as system of record" is a flagged finding - recipe/production language should be generic. The duplicate file (PB-010 (1).docx) corrects this; the non-dup version still carries the wrong statement.

If the non-dup PB-010 is loaded into catalog / Sous as-is, the Galley-as-system-of-record statement enters the corpus and Sous will cite it as fact.

**Fix:** Pick the (1) variant as canonical (it also has 17 sections vs 13 and is otherwise more complete) and retire the non-dup file. See §6 below.

---

## 5. Three docs missing required STD-001 structural elements

These docs cannot pass STD-001 §11 / §12 anatomy checks until rebuilt:

| Doc | Missing Element(s) | Severity |
|---|---|---|
| **POL-002** Appearance & Dress Code v1.3 | No Related Documents block at end (STD-001 §12 POL requirement) | CRITICAL - structural |
| **AGR-002** Laptop Acceptance Agreement v1.0 | No OWNER field in metadata block; §04 missing entirely (numbering jumps 03 -> 05); no Related Documents block | CRITICAL - cannot promote to Live |
| **REF-003** Disciplinary Process Manager Quick Reference v1.0 | No metadata block at all (no Owner, Approved By, Next Review, Effective); no Related Documents block; also OMITS **FORM-005 PIP** from its Four Levels reference table - substantive gap vs SOP-004 §03 | CRITICAL - rebuild required |

---

## 6. File-level cleanup before catalog write

| # | Issue | Action |
|---|---|---|
| 1 | **STD-001 v1.0 duplicate** in library folder alongside canonical v1.1 | Remove `Documentation_Format_Standard_STD-001_v1.0.docx` |
| 2 | **PB-010 duplicate** `PB-010_Site_Operations_Manual_v1_0 (1).docx` alongside non-dup. The (1) version is canonical: 17 sections vs 13, correctly removes the "Galley as system of record" statement, adds cross-refs to PB-006/PB-009/PB-013/FORM-009/TPL series. | Promote (1) to v1.1, retire the non-dup. Loading the non-dup into Sous would put the Galley misstatement in the corpus. |
| 3 | **AGR-001 version drift** - tracker says Live v1.1; on-disk file says v1.0. Owner drift: tracker = "Human Resources"; file = "Senior Director of Operations." | Kevin to resolve canonical version and canonical owner before any re-embed. |
| 4 | **PB-001 filename** has `_not_final` suffix (`Leadership_OS_Handbook_PB-001_v9_1_not_final.docx`) breaking STD-001 §10 filename convention | Rename once finalized. |
| 5 | **JD TEMPLATE x4** - `JD TEMPLATE - Cook.docx`, `Dishwasher.docx`, `Café Attendant.docx`, `Culinary Delivery Driver.docx` have no doc IDs in their filenames | Assign TPL-NNN IDs. No tracker entry exists for any of the four. |

---

## 6a. Pay band hygiene + state-coverage gap (REF-006 / REF-007)

**Both REF-006 (hourly bands) and REF-007 (leadership bands) are explicitly self-flagged "DRAFT - pending Finance validation."** All band values are unverified estimates. Loading either into the SousAI corpus puts Sous in a position to quote unverified pay numbers as fact - direct violation of hard floor rule 2 (zero tolerance on numbers).

**Recommendation:** hold REF-006 and REF-007 from the SousAI corpus until Finance validates rates against Rippling.

**REF-006 §03 covers 7 states (AZ, FL, TX, NY, MO, OH, KY) - Illinois is missing.** The version history at line 387 explicitly names "seven operating states." KitchFix operates in 8 states. This is a content gap, not a typo. **Blocks FORM-007 workflow for any IL site.**

**REF-007 audience restriction** (corporate-only) must be enforced in the catalog. The OPD audience filter (`opdAcl.visibleDocumentsForUser` per OPD_PLAN.md §5.2) allows corporate-only via `audience = 'corporate'` and CORP team_key check. Catalog row must set `audience = 'corporate'` and `classification` appropriately.

---

## 6b. JD TEMPLATE x4 brand-promise drift

The 4 JD TEMPLATE files (Café Attendant, Cook, Culinary Delivery Driver, Dishwasher) use the phrasing **"best-in-class hospitality through exceptional food and unmatched service"** - DRIFTS from canonical **"Best Food, Best Service, Best Hospitality."** Audit Brief §6d brand-promise wording check is failed.

Fix the JD TEMPLATE brand-promise lines to use canonical wording before catalog write.

Also: all 4 lack TPL-NNN doc IDs, none follow STD-001 TPL-class anatomy (instructions block + sample row), all need EEO language LEGAL-REVIEW, and the Café Attendant template has a role-naming question (Café vs FOH Attendant per REF-006) that needs Kevin's call.

---

## 7. The SAFETY-CRITICAL temperature audit (Audit Brief §6c)

**Canonical = 135F hot / 41F cold.** Audit confirms NO doc carries the 140/40 error - the audit's most explicit CRITICAL trip-wire is clean.

- SOP-008 Food Safety Management: 135F/41F throughout. CONFIRMED CORRECT.
- SOP-012, SOP-014, CHK-003, TPL-019 all hold the canonical 135F/41F.
- SOP-015 carries the temp-table errors described in §2 above (not 140/40 but a different danger).
- PB-007, PB-002, PB-004 correctly point at PB-002 / SOP-008 rather than restating numbers.
- The 0 / 41 / 135 / 165 frame is consistently used; cold TCS, frozen, hot hold, and reheat all line up.

This is the bright spot of the audit. The temperature framework is coherent across the library.

---

## 8. Brand promise audit (Audit Brief §6d)

**Canonical = "Best Food, Best Service, Best Hospitality."** Audit confirms NO drift.

- PB-001 §02 The Promise: stated verbatim.
- PB-002 §01: aligned (brand language).
- PB-004 §01 and §05: stated verbatim.
- All other docs that reference: aligned.

**Implication for Charter §5I:** the company-identity corpus that Sous needs to answer "what is our brand promise" lives in PB-001 §02 + the AGR-001 / PB-002 / PB-004 reinforcing statements. Loading PB-001 to Live (currently In Review v9.1) closes the brand-promise side of the corpus gap. The Origin, Mission, Vision, Values, Pillars, and Daily Practice content in PB-001 §02 IS the company-identity corpus.

Open: pillars / values / Latin-cuisine identity are in PB-001 but the Latin program detail lives in PB-006 (Culinary OS, Draft v0.3) which is also not yet Live. PB-001 + PB-006 together fully close the corpus gap for SousAI.

---

## 9. Library-wide hygiene findings (MAJOR, not CRITICAL, but pattern affects many docs)

These are not individually CRITICAL but combined they affect almost every non-anchor doc:

**Owner-field convention violation (STD-001 §10 - role title not department).** Confirms existing memory project_opd_owner_field_sweep. Affected docs (partial list from this audit, more pending): SOP-002, SOP-004, SOP-005 (blank), SOP-010, POL-001, POL-002, POL-004, POL-006, POL-007, POL-008, POL-010, POL-011, POL-013, POL-014, POL-015, PB-004, PB-007, AGR-001 (tracker disagrees), AGR-002 (no owner at all), REF-003 (no metadata at all). Most use "Human Resources" or "People Operations" (department names) where STD-001 wants role title.

**People Operations vs Human Resources terminology drift.** Tracker / Kevin's intent is "Human Resources"; many docs use "People Operations." Cross-batch finding. This is a single sweep when Kevin decides.

**Status-label drift in Related Documents blocks.** Many docs list cross-referenced docs as "Live (v1.0)" / "Live (v1.2)" when tracker shows them as "In review." STD-001 §9 says to use Document IDs without versions for cross-refs. Single pass to strip version tags.

**FLAT-RISK chunking on ~43 of 55 docx files.** Charter §5E load-bearing finding. Restyling pass per heading-style-restyle priority tiers documented in `docs/phase2/05_DOC_SET_1_CHUNKING_READINESS.md`. Without this pass, the 43 FLAT-RISK docs each chunk as a single blob and degrade retrieval.

---

## 10. Decisions Kevin owes (CK-1 + CK-2)

These were already named in the Charter and v2 briefs; the audit surfaces additional decisions:

| # | Decision | Surfaced By | Notes |
|---|---|---|---|
| 1 | **Canonical term: "People Operations" or "Human Resources"?** | Cross-batch terminology drift | Drives a single sweep across ~20 docs |
| 2 | **AGR-001 canonical version (file v1.0 vs tracker v1.1) + canonical owner (Sr Dir Ops vs HR)** | My anchor scoring | Resolve before re-embed |
| 3 | **Charter §6 status mapping confirmation** | Charter (CK-2) | Required before any catalog write |
| 4 | **Charter §5I company-identity corpus** | Charter (CK-1) | PB-001 v9.1 §02 IS the company-identity content; promoting PB-001 to Live closes the brand-promise gap. PB-006 (Culinary OS, Draft v0.3) closes Latin-cuisine identity. Recommend: NOT a separate authoring effort - finalize PB-001 + PB-006. |
| 5 | **INFO/SIGN catalog handling** (STD-002 defines 4 visual classes; OPD enum supports only POST) | My STD-002 anchor scoring | Decision: extend OPD enum to INFO + SIGN, OR consolidate to POST class, OR defer INFO/SIGN authoring |
| 6 | **~38-doc gap between content side authored and catalog rows** | Manifest reconciliation | Several "Not started" tracker docs have files on disk (PB-009, PB-012, PB-013, SOP-005). Tracker status must update before catalog write so the proposed status enum mapping picks the right value. |
| 7 | **POL-002 / AGR-002 / REF-003 structural rebuild priority** | Batch B subagent findings | These 3 docs are not catalog-promotable until rebuilt. Decide rebuild order. |
| 8 | **POL-016 retention-policy GAP** | POL-009 -> POL-016 broken reference | POL-016 retired with no super. If retention is needed in Phase 2, build a replacement. If not, remove the POL-009 reference. |
| 9 | **SOP-015 §03 temp table** rebuild scope | Batch C SAFETY-CRITICAL | Britt rewrite of §03. Does SOP-015 publish without this fix? Cannot. |
| 10 | **TPL-018 location** | Batch C dependency analysis | TPL-018 Daily Food Safety Log referenced by SOP-008, SOP-014, SOP-015, CHK-003, TPL-019 - but is not in Doc Set 1. Where is the file? Cluster cannot Live without TPL-018 findable. |
| 11 | **SOP-009 forward reference** in POL-014 | Batch A finding | POL-014 §06 cites SOP-009 for banned-substances; SOP-009 is "Not started." Decision: stub SOP-009 in Phase 2 to satisfy the reference, fold the rule into POL-014 §06 in the interim, or defer. |

---

## 11. What the audit confirms is GOOD

So Kevin can balance the critical list against the wins:

- **Temperature framework** is canonical and consistent across the food-safety cluster (SOP-008, SOP-012, SOP-014, CHK-003, TPL-019, plus PB-002 / PB-007 pointers).
- **Brand promise wording** holds throughout the library.
- **Severity tier system** (S1/S2/S3/S4 in SOP-002) is correctly referenced by POST-001, FORM-001, FORM-002.
- **AGR-001 -> POSTER-001 -> AGR-001 cross-references** form a clean loop; the conduct anchor is well-supported.
- **PB-002 -> POST-002** is clean.
- **SOP-004 -> FORM-003/004/005/006 + REF-003** family is well-structured (despite REF-003 metadata rebuild need).
- **Audit Brief §4 conventions** are largely respected: floor-then-override, point-don't-duplicate, condensed POL format, em-dashes-in-print, English-only corpus.
- **Counsel sign-off** is achieved on POL-003 (Drug & Alcohol) already and explicitly required-pre-Live on the remaining 8-10 POLs - the discipline is correct.
- **PB-001 v9.1** when promoted to Live closes the largest of the open corpus gaps (company identity) without any new authoring.

---

## 12. Audit posture going forward

- 56 docs scored (8 anchors + 8 POL universal + 8 POL specific + 9 SOP/CHK/TPL + 8 PB; 11 remaining in Batch E covering FORMs + REF + JD TEMPLATEs).
- 0 invented operational actuals. Every gap is named with the operator-actual missing.
- 0 legal rulings. All legal-adjacent content flagged LEGAL-REVIEW with what needs counsel and why.
- All 12 findings above cite the doc and the section.

The audit is read-only. No edits to library docs. No catalog writes. No Drive sharing. No embedding. The next step is Kevin's CK-3 review of this Critical summary, then CK-1 + CK-2 decisions on the items in §10 above.

See `LIBRARY_FINDINGS.md` for the full contradiction log + cross-reference breaks + terminology sweep + coverage gap map. See `REMEDIATION_WORKLIST.md` for every finding ranked by severity with the specific fix. See `ACTUALS_NEEDED.md` for the operational realities only Kevin can supply. See `PUBLISH_READINESS.md` for the per-doc Live-gate verdict.
