# Scorecards - Anchor Docs (Live + GOOD-structure + load-bearing)

**Scored by:** main CC session. **9 docs:** SOP-002, PB-002, PB-003, AGR-001, STD-001 v1.1, STD-001 v1.0 (dup), STD-002 v0.2, PB-001 v9.1, POL-003 v1.1.

---

## SOP-002 Safety & Incident Management

**File:** Safety_and_Incident_Management_SOP-002_v2_1.docx
**Tracker status / version:** Live v2.1
**Structure verdict (chunking probe):** GOOD (10 H1 + 25 H2)

**Part 1 - Identification**
- id_in_document: SOP-002 (match)
- title_matches_tracker: yes
- version_in_document: v2.1 · Effective 2026-05-04 (match)
- metadata_finding: Owner = "Human Resources" (department, not role title). STD-001 §10 says "role title, not personal name" - department also breaks the role-title intent. MAJOR. (Memory: this is part of the OPD-wide owner-field convention sweep.)

**Part 2 - Document-level**
- A1 Accuracy: PASS - no food temps stated (correctly handled in PB-002 / SOP-008); regulatory facts (REF-001, The Hartford carrier) sourced.
- A2 Actionability: PASS - 6-step process, notification matrix with timing, role assignments named.
- A3 Completeness/Actuals: PASS - REF-001 is explicitly flagged as placeholder pending Hartford content (§10) - that is honest, not a thin spot.
- A4 Format/Metadata: ISSUES - Owner field uses department not role (see Part 1). Format is otherwise STD-001 compliant.
- A5 SousAI-readiness: PASS - real heading hierarchy (chunks well); no template-as-canonical risk; numbers (S1 = 15 min, S2 = 30 min, S3 = 4 hr, S4 = weekly digest) are concrete operational specs.

**Part 3 - Library checks**
- cross_refs_in_text: POL-001 (§1, §9), PB-003 (§1 boundary), FORM-001 (§7.1), FORM-002 (§7.2), PB-002 (§7.3), SOP-004 (§8.5), REF-001 (§10), POST-001 (Appendix B), POL-005 (none found), SOP-016 (none found - good, since SOP-016 was retired and absorbed into §07.4)
- inbound_retired_pointer: **YES - CRITICAL** - Tracker References Map shows SOP-002 names TPL-017 as "Companion Form." TPL-017 is RETIRED (intranet incident log is the system of record now). SOP-002 Related Documents must remove TPL-017 or repoint to the intranet log.
- contradiction_within_doc: none
- terminology_drift: §06 phone-tree mentions "HR" (correct); §02 names "Human Resources" consistently
- legal_flag: §10 Workers' Comp - LEGAL-REVIEW for state-specific filing requirements (REF-001 placeholder)

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | Related Documents | References TPL-017 (RETIRED) as Companion Form | Remove or repoint to intranet incident log | no |
| MAJOR | Metadata | Owner = "Human Resources" (department); STD-001 §10 wants role title | Change to "Director of Human Resources" or whichever role title | yes - which role |
| MINOR | §10 | REF-001 placeholder note is honest but should explicitly say "pending Hartford content and counsel review" | Tighten the note | no |

**Part 5 - Catalog row draft**
- card_line: "How to identify, respond to, report, investigate, and close safety and operational incidents."
- summary: "The KitchFix safety and incident system of record. Defines who responds, what gets reported, how fast, on what cadence, against what classification, and how findings get acted on. Covers 9 incident types, 4 severity tiers, the 6-step universal response, the notification matrix, type-specific procedures (employee injury, vehicle, allergen, foodborne illness, food safety, property/equipment, non-employee, near-miss, security), workers' comp coordination, confidential reporting, and 30-day follow-up."
- keywords: [incident, safety, severity, S1, anaphylaxis, vehicle, allergen, foodborne, near-miss, workers comp, FORM-001, FORM-002, POST-001]
- shelf_proposed: Safety
- audience_proposed: operator (all staff)
- status_proposed_opd_enum: Live (already)

**Part 6 - Live-readiness:** Already Live. Block: TPL-017 reference is CRITICAL to fix in next version cut, but does not block current Live state.

**Part 7 - SME/actuals:** SME = HR (Mariela) for owner-field correction. Actual needed: which specific role title replaces "Human Resources."

**Part 8 - Verdict:** READY (already Live). Pre-existing CRITICAL: fix TPL-017 pointer in next version cut.

---

## PB-002 Allergen Playbook

**File:** Allergen_Playbook_PB-002_v1_0.docx
**Tracker status / version:** Live v1.0
**Structure verdict:** GOOD (6 H1 + 19 H2 + 6 H3)

**Part 1 - Identification**
- id_in_document: PB-002 (match)
- title_matches_tracker: yes
- version_in_document: v1.0 · Effective 2026-05-04 (match)
- metadata_finding: Owner = "Director of Culinary" (role title - GOOD)

**Part 2 - Document-level**
- A1 Accuracy: PASS - Top 9 allergens correct (FDA + Sesame). "No allergen-free meals" liability stance is consistent and correct. "Anaphylaxis Four" guidance is concrete.
- A2 Actionability: PASS - daily non-negotiables (labeling, cross-contact, vendor sub, storage, peanut/tree nut) are operator-actionable. Where it hides table is excellent reference.
- A3 Completeness/Actuals: PASS - no obvious thin spots. §05.2 Player Allergen Information correctly routes to "the Club's dietitian or medical staff" (not assumptions).
- A4 Format/Metadata: PASS - STD-001 compliant. Cover, metadata, contents, sections numbered, anchors/critical callouts used per §7 STD-001.
- A5 SousAI-readiness: PASS - structure-aware chunking will work well. §06 The Six Steps is exactly the kind of clear sequential content Sous can cite. No template-as-canonical risk. Numbers (Top 9, Anaphylaxis Four, 10-min notification per §06.4) are real.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-002 §06 (notification path), ServSafe Allergen training, "Culinary library" (§3.1 standard menu format), POST-002 (per references map)
- inbound_retired_pointer: no
- contradiction_within_doc: none
- terminology_drift: §05 uses "Site Leader" consistently; "Chef" used for Executive Chef without explanation - consistent with STD-001 vocabulary
- legal_flag: §04 "We do not offer allergen-free meals" - this is a liability decision worth confirming with counsel was reviewed (Approved by SLT, but counsel not separately named). LEGAL-REVIEW: confirm counsel signed off on the liability stance.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MINOR | §03.1 | "Culinary library" referenced without doc ID | Name PB-006 or "Culinary OS Handbook" with proper ID | no |
| MINOR | §05.4 | "2-3 minute allergen topic during pre-shift weekly" - rotation list is described but not specified | Define the weekly rotation as a rotating set (5 topics, weekly cycle) | no |

**Part 5 - Catalog row draft**
- card_line: "Top 9 allergens, daily non-negotiables that prevent a reaction, and what to do when one happens."
- summary: "The Performance Food Service standard for identifying, managing, and responding to allergens. Defines the Top 9, the Anaphylaxis Four, daily non-negotiables (labeling, cross-contact prevention, vendor substitution checks, storage, peanut/tree nut posture), Site Leader responsibilities, and the 6-step response sequence when a reaction occurs. Companion to SOP-002 §7.3."
- keywords: [allergen, allergy, anaphylaxis, top 9, cross-contact, peanut, tree nut, sesame, labeling, ServSafe Allergen, reaction, dietitian, PB-002]
- shelf_proposed: Safety (per tracker says "Safety & Incident" sub-shelf - schema shelf = Safety)
- audience_proposed: operator (BOH + FOH; ServSafe Allergen required)
- status_proposed_opd_enum: Live (already)

**Part 6 - Live-readiness:** Already Live and embedded.

**Part 7 - SME/actuals:** Britt (Dir Culinary) for any allergen list additions; Counsel sign-off documentation for §04 liability stance.

**Part 8 - Verdict:** READY (Live).

---

## PB-003 Service Recovery Playbook

**File:** Service_Recovery_Playbook_PB-003_v1_1.docx
**Tracker status / version:** Live v1.1
**Structure verdict:** GOOD (5 H1 + 16 H2)

**Part 1 - Identification**
- id_in_document: PB-003 (match)
- title_matches_tracker: yes
- version_in_document: v1.1 · Effective 2026-05-04 (match)
- metadata_finding: Owner = "Senior Director of Operations" (role title - GOOD)

**Part 2 - Document-level**
- A1 Accuracy: PASS - no factual claims that need verification. §1 NOTE correctly routes safety incidents to SOP-002.
- A2 Actionability: PASS - 5 moves (Acknowledge / Fix / Tell / Note / Carry Learning) are operator-grade. TRY THIS / NOT THIS examples are excellent for coaching.
- A3 Completeness/Actuals: PASS - the "no separate Quality Recovery Log" decision is documented.
- A4 Format/Metadata: PASS - STD-001 compliant.
- A5 SousAI-readiness: PASS - good structure. TRY THIS examples are EXAMPLE content; Sous's hard floor rule 7 (template-as-canonical) should handle correctly. No fabricated numbers.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-002 §1 (boundary), SOP-004 §5.3 (progressive action conversation), SOP-001 §4.3 (standard gap conversation), AGR-001 §06 (no client-side issue narrating), SOP-003 (supersedes - retired predecessor named on cover)
- inbound_retired_pointer: SOP-003 named in cover SUPERSEDES line - correct disposition (supersedes is the right rel_type). Not a CRITICAL break.
- contradiction_within_doc: none
- terminology_drift: §3.3 "Sous Chef and Hospitality Manager often communicate in real time" - aligned with site triad
- legal_flag: none

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MINOR | §5.3 | "SOP-004 (currently in HR + counsel review)" - dated reference; SOP-004 status will change | Update on next version cut after SOP-004 goes Live | no |

**Part 5 - Catalog row draft**
- card_line: "How good service recovery flows - acknowledge, fix, tell, note, carry the learning."
- summary: "Service recovery is the second half of service. The Playbook teaches the 5 moves a leader makes when something goes wrong, the communication discipline that protects the client relationship (what to say, what NOT to say), how to coach recovery at each level, and how to read patterns. No separate log beyond the daily site log. Quality misses only. Safety incidents follow SOP-002."
- keywords: [service recovery, miss, quality, acknowledge, fix, daily site log, coaching, RDO, Site Leader, Sous Chef, Hospitality Manager, pattern, AGR-001 §06]
- shelf_proposed: Operations (per tracker)
- audience_proposed: operator (all leadership levels)
- status_proposed_opd_enum: Live (already)

**Part 6 - Live-readiness:** Already Live and embedded.

**Part 7 - SME/actuals:** none.

**Part 8 - Verdict:** READY (Live).

---

## AGR-001 The Big Rules

**File:** The_Big_Rules_AGR-001_v1_0.docx
**Tracker status / version:** **Live v1.1 per tracker; on-disk file is v1.0** - VERSION DRIFT
**Structure verdict:** GOOD (9 H1 + 25 H2)

**Part 1 - Identification**
- id_in_document: AGR-001 (match)
- title_matches_tracker: yes
- version_in_document: v1.0 · Effective 2026-05-01 + "SUPERSEDES v0.9"
- **VERSION DRIFT - CRITICAL**: tracker says v1.1; file says v1.0. Resolve before any catalog write or re-embed. Two possibilities: (a) tracker is ahead, the v1.1 file is somewhere else (not in Doc Set 1), or (b) tracker drifted and on-disk v1.0 is canonical.
- metadata_finding: Owner = "Senior Director of Operations" (role title) - good. Note: tracker says owner = "Human Resources" - **OWNER FIELD DISAGREES BETWEEN FILE AND TRACKER**.

**Part 2 - Document-level**
- A1 Accuracy: PASS - MLR 21 text quoted verbatim. Confidentiality, Clubhouse Rules, Facility Conduct grounded.
- A2 Actionability: PASS - operator-grade with crisp prohibitions.
- A3 Completeness/Actuals: PASS - Section 9 Acknowledgement & Agreement signature page present (STD-001 §12 AGR requirement satisfied).
- A4 Format/Metadata: PASS - STD-001 AGR-class anatomy (signature page) satisfied. Cover, metadata, contents, sections, callouts.
- A5 SousAI-readiness: PASS - structure-aware chunking works. Number hygiene: no fabricated numbers; §5 MLR 21 references "one year" suspension and "three years" ineligibility which are MLR 21 text, not invented.

**Part 3 - Library checks**
- cross_refs_in_text: KitchFix Employee Handbook (referenced, not by doc ID - the handbook is PB-004 Hourly Handbook), LEGACY-PFS-CONF (in SUPERSEDES per tracker - not on cover of this file)
- inbound_retired_pointer: no (LEGACY-PFS-CONF is shown as superseded, not as current)
- contradiction_within_doc: §03 has H2 markers with empty body (sections 3.4, 3.5, 3.8 - artifacts of extraction; not a real issue but worth noting)
- terminology_drift: none. Brand promise not stated here (this is conduct, not values).
- legal_flag: §05 MLR 21 - **LEGAL-REVIEW** confirm MLR 21 text remains current. §08 "Confidentiality breaches result in termination of employment. They may also result in legal action..." - confirm counsel review of consequence language.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | Cover + Tracker | **Version drift**: file = v1.0, tracker = v1.1. Owner drift: file = "Sr Dir Ops", tracker = "Human Resources" | Resolve canonical version; reconcile owner field | yes - which is canonical |
| MINOR | §3.4 (no body), §3.5 (no body), §3.8 (no body) | Three [H2] markers with no body content - likely formatting artifacts in the docx | Audit the doc for missing content under these subsections | yes - confirm the doc is complete |
| MINOR | "KitchFix Employee Handbook" | Referenced as a doc but not by ID; PB-004 Hourly Employee Handbook is the likely target | Add PB-004 ID alongside the prose reference | no |

**Part 5 - Catalog row draft**
- card_line: "Confidentiality, clubhouse conduct, gambling integrity (MLR 21), and the path for raising issues. Signed annually."
- summary: "The conduct anchor for every PFS employee. Covers Confidentiality (what stays in the clubhouse), the 9 Clubhouse Rules (no photos, no autographs, no gambling, no PED talk, no media, no inside info, no dietary advice, no fraternization, no soliciting), Facility Conduct, Major League Rule 21 in full, the Communication & Escalation chain, and the Acknowledgement signature. Termination-level offenses on first occurrence for confidentiality and clubhouse-rule breaches; permanent baseball ineligibility under MLR 21."
- keywords: [confidentiality, clubhouse, MLR 21, gambling, autograph, dietary advice, fraternization, escalation, AGR-001, signed]
- shelf_proposed: HR & People (tracker sub-shelf = Conduct & People Ops)
- audience_proposed: operator (every PFS employee)
- status_proposed_opd_enum: Live

**Part 6 - Live-readiness:** Already Live. Version drift to resolve before re-embed.

**Part 7 - SME/actuals:** Counsel (MLR 21 currency check; §08 consequence language). Need from Kevin: canonical version (v1.0 or v1.1) + canonical owner.

**Part 8 - Verdict:** READY-PENDING-RECONCILIATION (file vs tracker version + owner drift).

---

## STD-001 v1.1 Documentation Format Standard (CANONICAL)

**File:** Documentation_Format_Standard_STD-001_v1_1.docx
**Tracker status / version:** Live v1.1 - **this is the canonical file**
**Structure verdict:** GOOD (14 H1 + 43 H2 + 8 H3)

**Part 1 - Identification**
- id_in_document: STD-001 (match)
- title_matches_tracker: yes
- version_in_document: v1.1 · 6/9/2026 (match)
- metadata_finding: Owner = "Senior Director of Operations" (role title) - good. NO approver field on cover (the SLT approver list is in §14 Approval, with signature lines).

**Part 2 - Document-level**
- A1 Accuracy: PASS - Contrast ratios verified to AAA. Hex values pinned.
- A2 Actionability: PASS - operator-grade for a brand/format standard.
- A3 Completeness/Actuals: PASS - this is the spec; no thin spots.
- A4 Format/Metadata: PASS - self-compliant. §12 Document Anatomy by Class lists 8 classes (PB, STD, POL, AGR, SOP, TPL, CHK, REF) - **DOES NOT INCLUDE FORM or POST class**. The OPD `documents` schema accepts 10 classes (adds FORM, POST). STD-001 §2 lists only 8 classes. **MAJOR finding**: STD-001 §2 class list and §12 anatomy table do not match the OPD catalog schema.
- A5 SousAI-readiness: PASS - structure is excellent. Template content risk: STD-001 IS the template-as-canonical hazard the Charter §5C describes. §7.2 Anchor Banner example is the one that already triggered Sous's correct decline on the brand-promise question. The §7.1 Promise Callout example contains the brand-promise text VERBATIM as an example - SousAI hard floor rule 7 correctly handles this, but the spec needs to make clear that the example is illustrative.

**Part 3 - Library checks**
- cross_refs_in_text: PB-001 v8.1 (legacy reference), STD-002 (§13 sub-standard), STD-003 (§13 sub-standard - Pending), PB-002, AGR-001, SOP-001
- inbound_retired_pointer: no
- contradiction_within_doc: none
- terminology_drift: §14 v1.1 changes "v0.97 line-spacing rule added" - but the doc itself is v1.1 not v0.97; the prose-history naming is mildly confusing but not a finding
- legal_flag: none

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | §02 + §12 | Class list omits FORM and POST. OPD catalog supports 10 classes (PB, SOP, TPL, REF, STD, POL, AGR, FORM, POST, CHK). STD-001 §02 lists 8. | Add FORM and POST class rows in §02 table and §12 anatomy. Per STD-002 §02, POST is governed by STD-002 - cross-reference. | no |
| MINOR | §7.1 Promise Callout example | The example contains the literal brand-promise text. SousAI rule 7 correctly declines, but in the spec it should be even more explicit that the text shown is illustrative. | Add an explicit "Example only - not canonical brand-promise content" caption beneath the Promise Callout example | no |
| MINOR | §03 Page Architecture | Line-spacing rule cites "New in v0.97" but the doc is v1.1 - history reference is fine but visually inconsistent | Audit the prose history references for v0.97/v0.96/v0.95 callouts; consider folding | no |

**Part 5 - Catalog row draft**
- card_line: "The format every internal KitchFix document follows. Typography, color, callouts, tables, page architecture."
- summary: "The Standard that defines format for every KitchFix internal document. Covers document classification (8 classes - update to 10 to match catalog), page architecture, typography hierarchy (Oswald display + Mulish body with Arial fallback chain), color palette (locked hex), banners and callouts (Anchor, Promise, Critical, Note), tables (Reference, SOP Process, RACI), cross-references and linking, naming-versioning-lifecycle, approval and review chain by class, document anatomy by class. STD-001 governs format - content is governed by each doc's approval chain."
- keywords: [STD-001, format, typography, callout, anchor, critical, note, promise, color palette, brand, Oswald, Mulish, navy, template]
- shelf_proposed: Brand & Standards
- audience_proposed: corporate / internal (doc authors)
- status_proposed_opd_enum: Live

**Part 6 - Live-readiness:** Already Live.

**Part 7 - SME/actuals:** none needed; class-list update is a self-edit.

**Part 8 - Verdict:** READY (Live). Add FORM and POST to §02/§12 in next minor version.

---

## STD-001 v1.0 (DUPLICATE FILE) - disposition only

**File:** Documentation_Format_Standard_STD-001_v1.0.docx
**Tracker status:** n/a (tracker shows only v1.1 as Live)
**Structure verdict:** GOOD (14 H1 + 43 H2 + 8 H3 - same structure as v1.1)

**Disposition recommendation**: This is a stale duplicate of STD-001 from v1.0. STD-001 v1.1 (the file alongside it) is the canonical Live version per tracker. **Action: remove or archive `Documentation_Format_Standard_STD-001_v1.0.docx` from the library folder.** Do NOT load both versions into the SousAI corpus - that would put two near-identical STD-001 chunks in retrieval contention. Tracker only references v1.1.

**Severity:** MAJOR - cleanup before catalog write.

---

## STD-002 v0.2 Visual Communication Standard

**File:** Visual_Communication_Standard_STD-002_v0_2.docx
**Tracker status / version:** In review v0.2 (Effective 2026-05-04)
**Structure verdict:** GOOD (real heading hierarchy throughout)

**Part 1 - Identification**
- id_in_document: STD-002 (match)
- title_matches_tracker: yes
- version_in_document: v0.2 · Effective 2026-05-04 (match)
- metadata_finding: Owner = "Senior Director of Operations" (role title) - good. SUPERSEDES "Visual Communication Standard v0.1 (STD-002)" - good lineage.

**Part 2 - Document-level**
- A1 Accuracy: PASS - severity colors specified to hex; tile-internal exception precise; layout patterns concrete.
- A2 Actionability: PASS - operator-grade for someone authoring visuals. PPTX-as-master workflow operationally testable.
- A3 Completeness/Actuals: PASS - §15 changes-from-v0.1 documents what shifted operationally.
- A4 Format/Metadata: PASS - STD-001 compliant.
- A5 SousAI-readiness: PASS - chunks well. Template-as-canonical risk: §7.8 "Worked Example - POST-001 Incident Reporting Quick Reference" is illustrative; correctly framed as an example.

**Part 3 - Library checks**
- cross_refs_in_text: STD-001 (parent), STD-003 (pending), PB-001 (Related Documents), SOP-002 (source for POST-001), PB-002 (source for POST-002), AGR-001 (source for POSTER-001)
- inbound_retired_pointer: no
- contradiction_within_doc: §02 lists 4 visual classes (POST, POSTER, INFO, SIGN). OPD catalog schema only supports POST class - INFO and SIGN would need to map to POST too, or schema would need extension. **MAJOR finding for the catalog.**
- terminology_drift: none
- legal_flag: none

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | §02 vs OPD schema | STD-002 defines 4 visual classes (POST/POSTER/INFO/SIGN). OPD catalog enum has only POST (POSTER prefix maps to POST). INFO and SIGN docs would not fit the catalog cleanly. | Either (a) extend the OPD enum to include INFO/SIGN, (b) decide POST class subsumes all visual artifacts and tag class via keyword, (c) defer INFO/SIGN authoring | yes - decision for Kevin |
| MINOR | Cover SUPERSEDES | Names v0.1 - good, but no v0.1 file appears to exist on disk currently | n/a - confirms v0.1 was draft-only | no |

**Part 5 - Catalog row draft**
- card_line: "How KitchFix builds postings, posters, infographics, and signage - the brand discipline at visual scale."
- summary: "The Standard for visual artifacts (POST / POSTER / INFO / SIGN). Different register from body docs - same brand discipline. Covers format specifications by class, typography for visuals (14pt body minimum, tile-internal exception), color system (brand palette plus 4-tier severity with S2 hybrid amber-plus-red border), Iconify-aggregated iconography, layout patterns (three-zone POST, single-focus POSTER, process and decision INFO layouts), bilingual standards (EN+ES recommended), logo use (alpha-channel verification), production and print specs (office-printer-first for POST/INFO), editable PPTX master with PDF published file, lifecycle and reissue protocol, source-of-truth SOP cross-check approval discipline."
- keywords: [STD-002, visual, posting, poster, infographic, signage, severity, S1, S2, tile, Iconify, Lucide, alpha-channel, PPTX, EN+ES]
- shelf_proposed: Brand & Standards
- audience_proposed: corporate / internal (visual-artifact authors)
- status_proposed_opd_enum: In Build (per Charter §6 mapping of tracker "In review") - **NOT YET LIVE**; STD-002 needs SLT approval signatures before Live promotion.

**Part 6 - Live-readiness:** Not yet Live. Blocks: SLT approval (Josh, Joe, Kevin), Counsel sign-off recommended for the bilingual workflow, end-user pilot of POST class (already covered by POST-001/002/003 builds).

**Part 7 - SME/actuals:** SLT signatures. Also: decision on INFO/SIGN class catalog handling.

**Part 8 - Verdict:** READY-PENDING-SME (SLT approval signatures; INFO/SIGN catalog mapping decision).

---

## PB-001 v9.1 Leadership OS Handbook

**File:** Leadership_OS_Handbook_PB-001_v9_1_not_final.docx
**Tracker status / version:** In review v9.1 ("not_final" in filename)
**Structure verdict:** GOOD (9 H1 + 39 H2 + 89 H3 - largest doc)

**Part 1 - Identification**
- id_in_document: PB-001 (match)
- title_matches_tracker: yes
- version_in_document: v9.1 · In review (match; tracker says In review v9.1 same)
- metadata_finding: Owner = "Senior Director of Operations" (role title) - good. Filename `_not_final` suffix is informal and should be removed before final publication per STD-001 §10 filename convention. MINOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS for the sections read - origin story and brand-promise wording match canonical "Best Food, Best Service, Best Hospitality." Roles + reporting structure consistent with org map (Josh CEO -> Joe VPO -> Kevin Sr Dir Ops + Britt Dir Culinary).
- A2 Actionability: PASS for the sections read - role definitions are operator-grade.
- A3 Completeness/Actuals: PASS - this IS where company identity is written down (Origin, Mission, Vision, Values, Pillars, Promise, Non-Negotiables). **This is exactly the company-identity corpus the Charter §5I asks Kevin about. Loading PB-001 into the SousAI corpus IS the answer to the company-identity gap.**
- A4 Format/Metadata: PASS - STD-001 compliant.
- A5 SousAI-readiness: PASS - GOOD structure means chunking will surface Mission, Vision, Values, Promise as distinct retrievable chunks. Template-as-canonical risk: none. Number hygiene: §07 Accountability System contains scoring data - confirm these are spec, not example data.

**Part 3 - Library checks**
- cross_refs_in_text (from §01-§05 read):
  - **§03 ANCHOR says "See PB-003 Culinary OS Handbook"** - **CRITICAL FINDING**. The Culinary OS Handbook is PB-006 per tracker. PB-003 is the Service Recovery Playbook. Tracker note confirms "PB-006 renumbered from PB-003 (collision with Service Recovery). Pending confirmation." So this is a known active error.
  - AGR-001 The Big Rules (§02 Non-Negotiables: Trust)
  - PB-005 (per tracker Related Documents)
  - PB-006 (per tracker §3 Culinary Philosophy anchor - but the body of §03 says PB-003)
- inbound_retired_pointer: not in sections read
- contradiction_within_doc: not in sections read
- terminology_drift: "client" used consistently; "Site Leader (EC & GM)" naming convention introduced in §05 - consistent
- legal_flag: §05 Site Leadership role definitions - LEGAL-REVIEW recommended for at-will employment language (not yet visible in sections read)

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **CRITICAL** | §03 Culinary Philosophy ANCHOR | "See PB-003 Culinary OS Handbook" - PB-003 is Service Recovery; the Culinary OS Handbook is PB-006 | Replace PB-003 with PB-006 throughout §03 | no - already a known fix |
| MINOR | Filename | "_not_final" suffix breaks STD-001 §10 filename convention | Rename to `Leadership_OS_Handbook_PB-001_v9_1.docx` once finalized | no |
| MAJOR (deferred) | (full doc) | Full audit beyond §01-§05 needed before Live promotion | Continue full read pass when scoring deepens | no |

**Part 5 - Catalog row draft**
- card_line: "How KitchFix's leadership operates - culture, client promise, the five roles, the accountability system."
- summary: "The leadership operating constitution. Defines company culture (origin, mission, vision, values, pillars, brand promise, daily practice, non-negotiables), culinary philosophy (4 values - Intentional, Authentic, Responsible, Inspiring), client promise (what every account gets), the 5 leadership roles (RDO, Site Leader / EC & GM, Sous Chef, Hospitality Manager, Corporate Field Chef), the 6 themes every role is evaluated on (people first; compliance last), and the SLA section (split out to PB-005). Companion to PB-006 Culinary OS Handbook."
- keywords: [PB-001, leadership, Site Leader, Executive Chef, Sous Chef, Hospitality Manager, RDO, Corporate Field Chef, mission, vision, values, pillars, hospitality promise, brand promise, accountability, scorecard, cadence matrix]
- shelf_proposed: Operations (tracker sub-shelf = Leadership & Performance)
- audience_proposed: operator (leadership) + corporate
- status_proposed_opd_enum: In Build (currently In Review per tracker) - **NOT YET LIVE** despite high importance

**Part 6 - Live-readiness:** Blocks: SLT review (per tracker); rename file to remove "_not_final" suffix; full audit beyond §01-§05 before promotion; resolve PB-003/PB-006 confusion.

**Part 7 - SME/actuals:** SLT review pending. Britt for §03 Culinary Philosophy renumber. No operational actuals needed; this is doctrine.

**Part 8 - Verdict:** READY-PENDING-SME (SLT review + §03 fix). Once approved, this is the company-identity corpus answer to Charter §5I item 1.

---

## POL-003 Drug & Alcohol Policy

**File:** POL-003_Drug_Alcohol_Policy_v1_1.docx
**Tracker status / version:** In review v1.1
**Structure verdict:** GOOD (11 H1 + 14 H2)

**Part 1 - Identification**
- id_in_document: POL-003 (match)
- title_matches_tracker: yes
- version_in_document: v1.1 · Effective 6/12/2026 + "Approved By SLT + Counsel · 06/2026"
- metadata_finding: Owner = "People Operations" (per tracker = "Human Resources" - **TERMINOLOGY DRIFT**, since the People Ops -> Human Resources sweep is pending). The doc uses "People Operations" 12+ times; tracker is updating. MINOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - MLB Program references (DPOC, TUE, NSF Certified for Sport, BAC 0.08%) are factual. Schedule I/II under CSA - correct.
- A2 Actionability: PASS - §07 Manager Responsibilities is operator-grade. Reasonable suspicion observable list is concrete.
- A3 Completeness/Actuals: PASS - Counsel reviewed and signed off per cover. TUE process names Dr. Bryan W. Smith and his contact info - **NUMBER HYGIENE FLAG: confirm this is the current MLB Medical Representative and not stale data.**
- A4 Format/Metadata: PASS - STD-001 compliant. CRITICAL and ANCHOR callouts used appropriately.
- A5 SousAI-readiness: PASS - structure is good. Template-as-canonical risk: §07 reasonable-suspicion list is operational guidance, not template. Number hygiene: BAC 0.08% (CSA + federal standard, correct); 30 days for DPOC evaluation (MLB Program); annual TUE renewal. All sourced. **One concern**: Dr. Bryan W. Smith email/phone - confirm current.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-004 (§01, §08), POL-001 (§08 retaliation protection), STD-001 (Related Documents), SOP-002 (Related Documents), PB-004 (Related Documents), FORM-004 (§07), FORM-006 (§07), AGR-001 (Related Documents)
- inbound_retired_pointer: no
- contradiction_within_doc: §01 says "People Operations (HR)" - mixed usage of both terms within the doc and against the tracker; per Charter known terminology sweep
- terminology_drift: **MAJOR** - "People Operations" used throughout; tracker / canonical is "Human Resources" sweep pending
- legal_flag: §04 MLB Program coverage / §05 marijuana state-vs-federal / §08 consequences table all are LEGAL-REVIEW areas - **per cover, counsel already approved 06/2026**. Good.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Throughout (Owner field + §10) | "People Operations" used throughout; tracker says "Human Resources." Pending sweep. | Apply People Ops -> Human Resources sweep when run | no - tracked sweep |
| MINOR | §09 TUE contact (Dr. Bryan W. Smith - 336-460-1935 - Bryan.Smith@mlb.com) | Personal contact for MLB Medical Rep - verify current; this is a Sous number-hygiene risk if stale | Confirm with MLB / tracker note | yes - confirm currency |
| MINOR | Related Documents list | STD-001 listed as "v1.0" but canonical is now v1.1 (STD-001 was updated 6/9/2026, POL-003 effective 6/12/2026) | Update Related Documents to STD-001 v1.1 | no |

**Part 5 - Catalog row draft**
- card_line: "Substance-free workplace, the MLB drug program coverage, supplements protocol, prescription medication, reasonable-suspicion process."
- summary: "Governs alcohol, drugs, and controlled substances in connection with employment. Covers prohibited conduct (CRITICAL on reporting impaired), MLB Drug Policy and Prevention Program for Non-Playing Personnel (Covered Individuals - chefs are named for mandatory testing), marijuana and alcohol DPOC automatic-referral triggers, nutritional supplements protocol (NSF Certified for Sport only - KitchFix supplies none), manager responsibilities (reasonable-suspicion observable behaviors), KitchFix and MLB Program consequences on parallel tracks, prescription medication and Therapeutic Use Exemptions, return-to-work decision. Counsel-approved 06/2026."
- keywords: [POL-003, drug, alcohol, substance, MLB, DPOC, Covered Individual, chef, NSF, supplement, BAC, reasonable suspicion, TUE, marijuana, prescription, return to work]
- shelf_proposed: HR & People (tracker sub-shelf = People Policies)
- audience_proposed: operator (every employee; managers for §07)
- status_proposed_opd_enum: In Build pending SLT publication (already counsel-approved per cover)

**Part 6 - Live-readiness:** Blocks: SLT publication signoff per Charter §6 mapping; People Ops -> HR terminology sweep before Live.

**Part 7 - SME/actuals:** Counsel done. SLT publish. Verify MLB Medical Rep contact currency.

**Part 8 - Verdict:** READY-PENDING-SLT (counsel done; SLT publish + terminology sweep pending).

---

## Cross-anchor observations

**Brand promise wording** is consistent across PB-001, AGR-001 prose, PB-002 §0 (anchor), PB-003 §0 prose: "Best Food, Best Service, Best Hospitality." Sous's company-identity question would now answer correctly IF PB-001 lands in the corpus (currently it is In Review, not Live).

**SOP-002 -> TPL-017** is a confirmed CRITICAL live pointer to a retired doc (TPL-017 was superseded by the intranet incident log).

**Owner-field terminology drift** affects multiple docs: SOP-002 (Human Resources department), POL-003 (People Operations), AGR-001 (tracker says HR; file says Sr Dir Ops). Per STD-001 §10, owner is role title. The People Ops -> HR sweep needs to land before any catalog write.

**PB-001 v9.1 §03 mis-cites PB-003 as Culinary OS Handbook** - this is the renumber-from-PB-003-to-PB-006 known issue. PB-003 is Service Recovery, PB-006 is Culinary OS. CRITICAL fix.

**AGR-001 version drift** (file v1.0 vs tracker v1.1) requires Kevin's resolution before re-embed.

**STD-001 § class list omits FORM and POST**; OPD catalog schema includes both. Minor discrepancy worth fixing in STD-001 §02 next version.

**STD-002 visual classes (POST/POSTER/INFO/SIGN)** are a partial mismatch with OPD enum (only POST/POSTER supported via class mapping). INFO + SIGN docs would not fit catalog enum cleanly today.
