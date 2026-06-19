# OPD Audit Pass 1 - Batch B Scorecards

**Batch:** B (POL + AGR + REF + FORM)
**Scope:** 8 documents - POL-001, POL-002, POL-004, POL-006-ES, POL-009, AGR-002, REF-003, FORM-001
**Date:** 2026-06-14
**Mode:** Read-only Pass 1 audit per RUBRIC_PACK.md

---

### POL-001 Employee Concerns Policy

**File:** POL-001_Employee_Concerns_Policy_v1.0.txt
**Tracker status / version:** In review (v1.0) - Owner: HR (per manifest; doc says People Operations)
**Structure verdict (chunking probe):** FLAT-RISK - no `[H1]/[H2]/[H3]` markers in extraction; section headers present as text only ("SECTION 01", etc.). Will chunk as one or two large blobs absent real Word heading styles.

**Part 1 - Identification**
- id_from_filename: POL-001
- id_in_document: POL-001
- title_matches_tracker: yes
- version_in_document: v1.0 (Effective 6/12/2026)
- version_in_tracker: v1.0
- metadata_finding: Owner field reads "People Operations" - terminology drift; STD-001 §10 calls for role title, and the convention list says "Human Resources" not "People Operations." MAJOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - no food safety temps to check; legal-adjacent language is appropriately hedged. No factual claims that can be falsified within Pass 1 scope.
- A2 Actionability: PASS - clear 3-step escalation ladder; names Mariela Chavez, Joe Lessard, Kevin Fietek at §02 NOTE; manager obligations enumerated in §05. Operator-readable.
- A3 Completeness/Actuals: PASS - explicit named contacts; explicit timing language ("one to two business days" acknowledgment); the §03 NOTE explicitly says timeframes are not fixed (intentional - not a thin spot). No placeholder text detected.
- A4 Format/Metadata: ISSUES - condensed POL format intentional per conventions; ANCHOR / NOTE / CRITICAL callouts present per STD-001 §11; Related Documents block present. BUT: owner field uses "People Operations" not a HR role title; missing Effective Date format consistency (uses "Effective 6/12/2026" which is acceptable). Lacks any "Last Reviewed" or revision line.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - the ANCHOR / NOTE callouts are policy commitments, not specimens. No example data Sous could mistake for policy.
  - chunking_readiness: FLAT-RISK - no heading style markers in extracted text. The "SECTION 01" text is paragraph text, not a Heading 1 style. Whole doc will likely chunk as one block.
  - number_hygiene: only "one to two business days" (intentional range, not a placeholder). No dollar/date placeholders. Names are real (Mariela Chavez, Joe Lessard, Kevin Fietek). Fine.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-002 (Related Documents - "Live (v2.1)"), SOP-004 (§01 and §05; Related Documents - "Live (v1.0)"), AGR-001 (Related Documents - "Live"), PB-004 (Related Documents - "Live (v1.0)"), STD-001 (Related Documents - "Live (v1.0)")
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "People Operations" used as owner and as the receiving body throughout (e.g., §02 NOTE, §03 Review, §05 Manager Obligations). Convention list says "Human Resources" not "People Operations." Also: STD-001 reference shows "(v1.0)" but tracker has STD-001 at v1.1 - downstream status-label drift. PB-004 ref shows "Live (v1.0)" but tracker says v1.2 in review - more status-label drift.
- legal_flag: LEGAL-REVIEW: §01 NOTE asserts at-will / not-a-contract language; §05 No Retaliation language paraphrases legal protections; §06 Good Faith Requirement language. Counsel should sign off given anti-retaliation regulatory exposure.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | Owner field reads "People Operations" not a Human Resources role title per convention. | Replace with role title (e.g., "Human Resources" or "HR Generalist"). Cross-batch pattern. | no |
| MAJOR | Body (multiple) | "People Operations" used throughout instead of "Human Resources." Terminology-drift pattern. | Sweep and reconcile with PB-004 and SOP-002 phrasing. Confirm with Kevin which term wins. | yes - Kevin call on canonical term |
| MAJOR | Whole doc | No real Word heading styles - FLAT-RISK chunking. | Apply Heading 1 style to each "SECTION NN" line; Heading 2 to sub-headings within. | no |
| MINOR | Related Documents | STD-001 shown as "Live (v1.0)" but tracker says v1.1; PB-004 shown as v1.0 but tracker says v1.2. | Reconcile status labels - convention is point-don't-duplicate via Document ID without version. | no |
| MAJOR | §05 No Retaliation | Anti-retaliation language is legally consequential and should be counsel-confirmed. | Flag LEGAL-REVIEW. Do not edit. | no |
| MINOR | §02 NOTE | Names ops leadership inline (Mariela, Joe, Kevin). If any of these change, doc is stale. | Either keep but accept maintenance debt, or point at an org chart (REF-004 planned). | no |

**Part 5 - Catalog row draft**
- card_line: "How to raise a concern at KitchFix - who to go to, what happens next, and the no-retaliation rule."
- summary: "POL-001 defines how KitchFix employees raise concerns about harassment, discrimination, retaliation, wage disputes, and workplace safety. It sets a three-step escalation ladder (manager - RDO/HR - VP/Sr Dir Ops), confidentiality limits, and the no-retaliation rule. Manager obligations on receipt are spelled out. Performance and conduct issues route to SOP-004 instead; this Policy covers concerns about treatment and conditions."
- keywords: [concern, complaint, harassment, retaliation, escalation, HR, People Operations, Mariela, anonymous, confidentiality]
- shelf_proposed: HR & People
- audience_proposed: operator
- status_proposed_opd_enum: In review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: PARTIAL - "People Operations" is a function name not a role title; convention says "Human Resources"
- approver_present: yes (SLT + Counsel · 06/2026)
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: real Word heading styles applied; terminology sweep (People Ops vs HR); LEGAL-REVIEW sign-off; card_line + summary written.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Counsel
- Actual needed from Kevin: canonical naming - "Human Resources" or "People Operations"? Decision drives a cross-doc sweep.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Content is substantive and operator-actionable. Blocked by Word heading styles for chunking, the People Ops vs HR terminology call, and counsel sign-off on anti-retaliation language.

---

### POL-002 Appearance & Dress Code Policy

**File:** POL-002_Appearance_Dress_Code_Policy_v1.3.txt
**Tracker status / version:** In review (v1.3) - Owner: HR (per manifest; doc says People Operations)
**Structure verdict (chunking probe):** FLAT-RISK - no heading-style markers in extraction; long doc that will chunk as one or two blobs.

**Part 1 - Identification**
- id_from_filename: POL-002
- id_in_document: POL-002
- title_matches_tracker: yes
- version_in_document: v1.3 (Effective 6/12/2026)
- version_in_tracker: v1.3
- metadata_finding: Owner is "People Operations" - same terminology drift as POL-001. MAJOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - food-safety-adjacent claims (nail-polish prohibition while handling food, hair restraint) align with standard foodservice expectations. No regulatory temp claims. Defers vendor/SKU detail to REF-002 (correct floor-then-override).
- A2 Actionability: PASS - role-by-role uniform tables; specific items (Polo x3, Chef Coat x3); Site Manager named as final authority on item condition; explicit pay-deduction rule for sent-home incidents (§06 CRITICAL).
- A3 Completeness/Actuals: PASS - reasonable specifics throughout. Refers to REF-002 for procurement detail (correct point-don't-duplicate). Names Mariela Chavez at §06.
- A4 Format/Metadata: ISSUES - condensed POL format intentional per conventions; ANCHOR / NOTE / CRITICAL callouts present; Related Documents block IS missing here - this doc has no Related Documents section visible in the extraction tail. Per STD-001 §11 the related-docs block is required for POL class.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - tables describe required items, not specimens. No example data Sous could mistake for vendor list.
  - chunking_readiness: FLAT-RISK - no heading-style markers. Doc has four uniform-by-role tables that need to chunk distinctly (FOH vs BOH-Guest-Facing vs BOH-Commissary vs Chef) - critical operator-facing distinction. Without heading styles those tables will mash together.
  - number_hygiene: "first hat for each employee" (manager pays), "x3" quantities, "$0 first replacement," "100%" not present. Numbers are operational (uniform allotments). Fine.

**Part 3 - Library checks**
- cross_refs_in_text: REF-002 (§01 NOTE, §04 intro, §05 NOTE - Uniform Standards Catalog), SOP-004 (§06 NOTE - Formal Disciplinary Process)
- inbound_retired_pointer: NO
- contradiction_within_doc: none detected
- terminology_drift: "People Operations" used as owner and inline (§02 NOTE accommodation, §06 NOTE contact). Same People Ops vs HR pattern as POL-001. Brand promise quoted correctly: "Best Food, Best Service, Best Hospitality" (§01 ANCHOR).
- legal_flag: LEGAL-REVIEW: §02 NOTE accommodation language (medical / religious) is ADA / Title VII adjacent. §06 CRITICAL on "not eligible for pay for the time missed" needs counsel review for FLSA / state wage law (especially across the 8 states). Do not rule.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | End of doc | Related Documents block missing - STD-001 §11 requires it for POL class. References Map shows POL-002 should reference STD-001, AGR-001, REF-002, SOP-004. | Add a Related Documents table at end listing STD-001, AGR-001, REF-002, SOP-004. | no |
| MAJOR | §06 CRITICAL | "Not eligible for pay for the time missed" claim has FLSA / state wage exposure across 8 states. | LEGAL-REVIEW required. Counsel call on whether this clause holds in IL, NY, AZ et al. | yes - counsel input |
| MAJOR | Metadata + body | "People Operations" used as owner and inline; convention says "Human Resources." Cross-batch pattern. | Sweep. Confirm canonical term with Kevin. | yes - Kevin call |
| MAJOR | Whole doc | No real Word heading styles - FLAT-RISK chunking. Role-by-role tables (§04) particularly need clean H2 separation. | Apply Heading 1 to "SECTION NN" lines; Heading 2 to role-uniform sub-headings (FOH, BOH-Guest, BOH-Commissary, Chef). | no |
| MAJOR | §02 NOTE | ADA / religious accommodation language is legally consequential. | LEGAL-REVIEW. | no |
| MINOR | §06 NOTE | "KitchFix Formal Disciplinary Process (SOP-004)" - confirm status label is current. Drop version per point-don't-duplicate. | Just "SOP-004 Formal Disciplinary Process" is enough. | no |
| MINOR | §01 NOTE | Spanish phrase "comúníquese" has stray accent on second u. Should be "comuníquese." | Fix typo. | no |

**Part 5 - Catalog row draft**
- card_line: "The KitchFix appearance and uniform standard - what to wear, what to ban, and how to handle a no-show-in-uniform."
- summary: "POL-002 governs appearance, hygiene, jewelry, and uniform standards for every KitchFix employee on client property. It defines client property scope, sets role-specific uniform tables (FOH, BOH guest-facing, BOH commissary, Chef), names KitchFix-provided versus employee-provided items, and routes vendor/SKU detail to REF-002 Uniform Standards Catalog. Client-stricter SLA requirements supersede. Non-compliance routes to SOP-004."
- keywords: [uniform, dress code, hat, polo, chef coat, hygiene, name tag, Shoes for Crews, jewelry, tattoo, REF-002]
- shelf_proposed: HR & People
- audience_proposed: operator
- status_proposed_opd_enum: In review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: PARTIAL - "People Operations" vs convention
- approver_present: yes (People Operations · 06/2026)
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: Related Documents block missing (CRITICAL); LEGAL-REVIEW on §06 pay-deduction; LEGAL-REVIEW on §02 accommodation; real heading styles; terminology sweep; card_line + summary; minor Spanish typo.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Counsel + Sr Dir Ops (Kevin)
- Actual needed from Kevin: confirm pay-deduction wording withstands state wage law review across 8 states; canonical owner term (HR vs People Ops); accommodation language counsel sign-off.

**Part 8 - Verdict**
- NOT-READY
- Rationale: Missing required Related Documents block (CRITICAL per STD-001 §11). Plus FLAT-RISK chunking and pay-deduction clause that needs counsel review.

---

### POL-004 Attendance & Punctuality Policy

**File:** POL-004_Attendance_Punctuality_Policy_v1_0.txt
**Tracker status / version:** In review (v1.0) - Owner: HR (per manifest; doc says People Operations)
**Structure verdict (chunking probe):** FLAT-RISK - no heading-style markers in extraction.

**Part 1 - Identification**
- id_from_filename: POL-004
- id_in_document: POL-004
- title_matches_tracker: yes
- version_in_document: v1.0 · Final
- version_in_tracker: v1.0
- metadata_finding: Owner is "People Operations" - same drift as POL-001 / POL-002. Also: header lacks "APPROVED BY" line - all other POL docs in this batch carry approver info; this one omits it. MAJOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - protected-leave categories listed accurately (FMLA, ADA, sick leave, jury duty, voting, USERRA, workers' comp); explicit deferral to People Operations. No regulatory temp claims. "Schedule published at least 7 days in advance" is a coverage commitment.
- A2 Actionability: PASS - definitions table is excellent; "ready to work at your station" definition of On-Time; "no more than 5 min before scheduled start" clock-in rule; 2-hour call-out window; multi-day check-in rule; explicit "two consecutive NCNS = voluntary resignation."
- A3 Completeness/Actuals: PASS - "Site Leader" naming used consistently (note: doc uses this term not "Site Manager" or "Executive Chef" - see drift check). Names Rippling as system of record for schedule and call-out log. Times and quanta are specific.
- A4 Format/Metadata: ISSUES - condensed POL format intentional; ANCHOR / NOTE / CRITICAL callouts present; Related Documents block present. Missing APPROVED BY field in metadata header.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - no specimens or example data.
  - chunking_readiness: FLAT-RISK - no heading-style markers. Definitions table in §02 is dense and needs clean H2 anchor or it will smush into §01.
  - number_hygiene: "7 days in advance," "5 minutes before," "2 hours before," "Two consecutive no-call/no-shows," "each day" for multi-day - all real operational quanta, not placeholders. Fine.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-004 (§01, §06, §08 - Formal Disciplinary Process; Related Docs - "Referenced"), POL-001 (§07 implicit via protected-leave routing to People Ops, but POL-001 is the concerns route - listed in Related Docs as "Live (v1.0)"), PB-004 (Related Docs - "Live (v1.2)"), STD-001 (Related Docs - "Live (v1.1)")
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "People Operations" used throughout (owner + §04 protected-leave routing + §07 + §08). Uses "Site Leader" - this differs from POL-002 ("Site Manager") and PB-004 likely uses "site manager" / "manager." STD-001 should canonize "Site Leader vs Site Manager" - flagged as cross-batch drift. Mentions "FCL / ACL" in §05 (FCL = Florida Complex League, ACL = Arizona Complex League) - acronyms not expanded, but these are baseball-industry shorthand the operator audience would know.
- legal_flag: LEGAL-REVIEW: §07 Protected & Approved Absences paraphrases FMLA, ADA, USERRA, state sick leave. §06 "Two consecutive NCNS treated as voluntary resignation" needs counsel review for state law variation (some states treat differently; some require notice).

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | APPROVED BY field missing. Other POL docs in batch (POL-001, POL-002, POL-009) carry it. | Add APPROVED BY line. Confirm approver with Kevin. | yes - approver identity |
| MAJOR | Metadata + body | "People Operations" used as owner and inline; terminology drift vs convention "Human Resources." Cross-batch pattern. | Sweep; confirm canonical term. | yes - Kevin call |
| MAJOR | Whole doc | "Site Leader" used throughout. Other batch docs use "Site Manager" / "Manager." Need single canonical role title - cross-doc drift. | Confirm canonical role title (PB-001 may settle this). Sweep. | yes - Kevin call on canonical |
| MAJOR | Whole doc | No real Word heading styles - FLAT-RISK chunking. Definitions table needs clean H2 anchor. | Apply Heading 1 / 2 styles. | no |
| MAJOR | §06 + §07 | NCNS-as-resignation language and protected-leave paraphrase - counsel review. | LEGAL-REVIEW. | no |
| MINOR | §05 | "FCL / ACL" not expanded on first use. Defensible for operator audience but worth a parenthetical on first use. | One-time expansion: "Florida Complex League / Arizona Complex League." | no |

**Part 5 - Catalog row draft**
- card_line: "Showing up on time, calling out properly, and what happens when attendance slips - the KitchFix standard."
- summary: "POL-004 sets the KitchFix attendance and punctuality standard. It defines on-time (ready at your station, in uniform, clocked in), the 2-hour call-out window, the no-call-no-show rule (one is a Level 1+ issue under SOP-004; two consecutive = voluntary resignation), game-day and homestand tightening, and routes protected leave to People Operations. KitchFix does not run a points or occurrence system - patterns are weighed in context."
- keywords: [attendance, punctuality, call-out, NCNS, no-call no-show, tardy, Rippling, Site Leader, game day, FMLA, protected leave]
- shelf_proposed: HR & People
- audience_proposed: operator
- status_proposed_opd_enum: In review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: PARTIAL - "People Operations" vs convention
- approver_present: NO
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: APPROVED BY field missing; real heading styles; terminology sweep (HR + Site Leader vs Manager); LEGAL-REVIEW; card_line + summary.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Counsel
- Actual needed from Kevin: who approves POL-004 (likely SLT or People Ops VP); HR vs People Ops; Site Leader vs Site Manager canonical.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Substantive, operator-actionable. Blocked by missing APPROVED BY metadata, heading styles, terminology sweep, and counsel review on NCNS-as-resignation + protected leave language.

---

### POL-006-ES Política contra el Acoso

**File:** POL-006-ES_Politica_contra_el_Acoso_v1_0.txt
**Tracker status / version:** In review (v1.0) - Owner: People Operations (per manifest)
**Structure verdict (chunking probe):** N/A for SousAI corpus - Spanish doc, NOT for English corpus per Audit Brief §4. Scored as a translation of POL-006.

**Note:** Per the rubric pack §2 ("English-only corpus") and the batch B context note, this doc is a wall posting / handbook translation companion to POL-006, not a Sous corpus member. Scoring focuses on whether the Spanish faithfully translates POL-006 and uses Spanish-fluent register. (I do not have the English POL-006 in this batch to do a sentence-by-sentence comparison; my read is a quality-of-Spanish + structural-parallelism check.)

**Part 1 - Identification**
- id_from_filename: POL-006-ES
- id_in_document: POL-006-ES
- title_matches_tracker: yes ("Política contra el Acoso" = Anti-Harassment Policy)
- version_in_document: v1.0 · Borrador (Draft)
- version_in_tracker: v1.0
- metadata_finding: Doc declares "Borrador" (Draft) while tracker says "In review." Reconcile - "In review" maps to OPD enum but the Spanish text suggests not yet at approval. Also: APROBADO POR field reads "Pendiente — SLT + Asesoría Legal" (Pending - SLT + Counsel). MINOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - protected-class enumeration (raza, color, religión, sexo, origen nacional, ascendencia, edad, discapacidad, orientación sexual, identidad de género, estado civil, condición militar / veterano, información genética) matches federal floor and is comprehensive. "30 días" investigation target stated as soft target.
- A2 Actionability: PASS for ESL hourly audience - simple, direct Spanish; names Mariela Chavez by name and role; explicit "nunca al cliente, siempre al liderazgo de KitchFix" rule for player / coach / club staff harassment.
- A3 Completeness/Actuals: PASS - reporting channels named; consequences spelled out; manager obligations enumerated.
- A4 Format/Metadata: PASS - condensed POL format; ANCLA / NOTA / CRÍTICO callouts mirror English STD-001 conventions; Contenido (TOC) present; Documentos Relacionados block at end. Structurally clean.
- A5 SousAI-readiness: N/A - Spanish doc not in English corpus per audit brief. Do not load. (If I were to score, it would be FAIL on chunking-readiness identical to other POLs in batch.)
  - template_as_canonical_risk: low
  - chunking_readiness: FLAT-RISK (same heading-style issue as other POLs) - but irrelevant since not corpus-bound.
  - number_hygiene: "30 días" target is operational, not placeholder. Fine.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-004 ("Proceso Disciplinario Formal" - §07; Related Docs - "Referenciado"), POL-001 (Related Docs - "Vigente (v1.0)"), STD-001 (Related Docs - "Vigente (v1.1)"), PB-004 (Related Docs - "Vigente (v1.2)")
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "Operaciones de Personal" (People Operations) used throughout - matches English POL-001 pattern. Brand promise: "Mejor Comida, Mejor Servicio, Mejor Hospitalidad" - faithful translation. Spanish register is appropriate operator-Spanish, not over-formal.
- legal_flag: LEGAL-REVIEW: same anti-harassment / EEO legal-content concerns as English POL-006. Bilingual counsel review ideal. Approver line already says counsel review pending.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | Doc reads "Borrador" (Draft) but tracker says "In review." Status mismatch. | Reconcile: either advance Spanish doc to In review or mark tracker accordingly. | no |
| MAJOR | Metadata | Approver pending - confirm counsel + SLT review. | Counsel sign-off then update APROBADO POR. | no |
| MAJOR | Cross-doc | Spanish faithfully mirrors English POL-006 structure (8 sections + Related Docs). I do not have English POL-006 text in this batch to verify line-by-line content parity. Recommend a side-by-side EN/ES diff by a bilingual reviewer. | Bilingual review pass post-EN-finalization. ES must update lockstep with EN POL-006 changes. | no |
| MINOR | Whole doc | Em-dashes are intentional per STD-001 (do NOT flag). Note observed for completeness. | None. | no |
| INFO | Audit scope | Not in SousAI corpus per Audit Brief §4 - confirmed. Take stub path. | n/a | no |

**Part 5 - Catalog row draft**
- card_line: "Política de KitchFix contra el acoso, la discriminación y las represalias - cómo reportar y cómo se maneja."
- summary: "POL-006-ES es la traducción al español de POL-006 Anti-Harassment Policy. Define qué está prohibido, cómo reportar (Líder del Sitio, Operaciones de Personal - Mariela Chavez, Director Sénior, VP Operaciones), cómo se investiga, la regla de no represalias, y las responsabilidades de los gerentes. Las inquietudes que involucran al personal del cliente nunca van al cliente directamente."
- keywords: [acoso, discriminación, represalias, reporte, Operaciones de Personal, Mariela, SOP-004]
- shelf_proposed: HR & People (POSTING / TRANSLATION track)
- audience_proposed: operator (ESL)
- status_proposed_opd_enum: In review (pending CK-2; ES corpus is stub path)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no (n/a - not for Sous corpus)
- owner_present_role_title: yes (Operaciones de Personal)
- approver_present: PENDING ("Pendiente")
- summary_keywords_present: no
- chunking_ready_real_headings: n/a (not corpus-bound)
- Blocks to Live: counsel approval; EN POL-006 must finalize first; bilingual review pass post-finalization.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + bilingual counsel
- Actual needed from Kevin: bilingual review process - who validates ES translation when EN POL-006 changes?

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Structurally sound translation; pending counsel approval that already says "Pendiente." Not for Sous corpus per audit brief.

---

### POL-009 IT & Acceptable Use Policy

**File:** POL-009_IT_Acceptable_Use_v1_0.txt
**Tracker status / version:** In review (v1.0) - Owner: Sr Dir Ops
**Structure verdict (chunking probe):** FLAT-RISK - no heading-style markers; doc is short and may chunk as one block.

**Part 1 - Identification**
- id_from_filename: POL-009
- id_in_document: POL-009
- title_matches_tracker: yes (IT & Acceptable Use Policy)
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: Owner reads "Senior Director of Operations" - role title, COMPLIANT. APPROVED BY = "SLT" (no date). Missing "Effective" date; missing "NEXT REVIEW" specifics (says "Annual" but no anchor month). MINOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - no regulatory temps; security best practices standard (strong passwords, no shared creds, no unauthorized software, report phishing). Pairs with AGR-002 correctly.
- A2 Actionability: ISSUES - very high-altitude. "Limited, reasonable personal use is acceptable" is judgment-call language without examples. "Be alert to phishing and report anything suspicious immediately" - report to whom? §07 says "Senior Director of Operations" for lost/stolen devices but not for general suspicious activity. Thin spots for ESL hourly audience.
- A3 Completeness/Actuals: ISSUES - thin doc (7 short sections). Key actuals missing: who is "IT" (Epoch IT per AGR-002 §03 NOTE - but POL-009 does not name them); incident reporting timing (24hr for AGR-002, unspecified here); password requirements (length, MFA?); approved systems list (where is "approved"?); retention period of logs.
- A4 Format/Metadata: ISSUES - condensed POL format OK; Related Documents block present; only ONE callout ("NOTE" in §05) - very sparse compared to other POLs in batch which use ANCHOR / NOTE / CRITICAL liberally. No ANCHOR statements at all - misses STD-001 §11 expectation for class anchors.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - no specimens.
  - chunking_readiness: FLAT-RISK - no heading-style markers; short doc may chunk fine as one piece but loses §-level granularity.
  - number_hygiene: no quanta in doc. "Immediately" appears 3 times but no clock-time. Fine but thin.

**Part 3 - Library checks**
- cross_refs_in_text: AGR-002 (§01, §03 - Laptop Acceptance Agreement; Related Docs - "Live"), POL-016 (Related Docs - "Live"), POL-014 (Related Docs - "Live"), SOP-004 (§07 + Related Docs - "Live"), STD-001 (Related Docs - "Live")
- inbound_retired_pointer: **YES - CRITICAL.** Related Documents lists POL-016 Record Retention & Destruction as "Live." POL-016 is RETIRED per manifest §3. No replacement (manifest notes "no super - GAP flagged").
- contradiction_within_doc: none
- terminology_drift: Uses "Sr Dir Ops" / "Senior Director of Operations" consistently. No People Ops vs HR pattern here (this is Ops-owned). Mentions "Rippling" as system of record for acknowledgment - correct.
- legal_flag: LEGAL-REVIEW: §05 Privacy & Monitoring waiver language ("no expectation of privacy ... may be monitored") - depending on state (CA-style or wiretap statutes), employee consent may need to be more explicit. Defer to counsel. §06 surveillance / data-sharing claims also benefit from counsel pass.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | Related Documents | Links to POL-016 (Record Retention & Destruction) as "Live." POL-016 is RETIRED per manifest with no superseding doc. | Remove POL-016 reference. Either drop it entirely until a replacement is authored or note "Pending replacement - record retention guidance from counsel." This is a GAP per manifest. | yes - Kevin call on what to point at since no super exists |
| MAJOR | §02 + §06 | High-altitude / judgment-call language ("limited reasonable personal use," "good judgment") with no examples or thresholds. Not enough for an ESL hourly user. | Add 1-2 concrete examples (e.g., "Streaming music between shifts on KitchFix laptop = OK. Streaming a movie during a call you should be on = not OK."). | yes - Kevin call on specifics |
| MAJOR | §04 + body | Key operational actuals missing: incident reporting timing (24hr like AGR-002?); password requirements; approved systems list; MFA expectation. | Add or point at AGR-002 / a checklist. | yes - actual requirements |
| MAJOR | Metadata | No "Effective" date; "NEXT REVIEW" only says "Annual" with no anchor month. APPROVED BY has no date. | Add effective date and review anchor month. | no |
| MAJOR | §05 + §06 | Privacy / monitoring waiver and prohibited-use clauses benefit from counsel review (state wiretap variation). | LEGAL-REVIEW. | no |
| MAJOR | Whole doc | No real heading styles; no ANCHOR callouts (STD-001 §11 expects them for POL class). | Apply heading styles; add ANCHOR statements where appropriate. | no |
| MINOR | §07 | "Report ... to the Senior Director of Operations immediately." Single point of failure if Kevin is unreachable. | Add fallback - e.g., RDO or VP Ops as escalation. | no |

**Part 5 - Catalog row draft**
- card_line: "Acceptable use of KitchFix tech - devices, accounts, email, Slack, data - and what's off-limits."
- summary: "POL-009 governs how KitchFix systems, accounts, and data are used and protected by every employee and contractor. Pairs with AGR-002 for laptop-specific responsibilities. Defines acceptable use, prohibited use, privacy / monitoring expectation, and routes violations to SOP-004. Lost or stolen devices go to the Senior Director of Operations."
- keywords: [IT, acceptable use, laptop, password, phishing, monitoring, Rippling, Epoch IT, security, devices]
- shelf_proposed: Operations
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes (v1.0; no Effective date)
- card_line_present: no
- owner_present_role_title: yes (Senior Director of Operations)
- approver_present: PARTIAL (SLT, no date)
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: CRITICAL retired-doc reference (POL-016); thin operational actuals; missing effective date; LEGAL-REVIEW; heading styles; card_line + summary.

**Part 7 - SME/actuals**
- SME: Sr Dir Ops (Kevin) + Counsel + Epoch IT
- Actual needed from Kevin: pointer for retention guidance (POL-016 retired with no super = GAP); password / MFA standard; approved-systems list; concrete examples for "limited reasonable personal use."

**Part 8 - Verdict**
- NOT-READY
- Rationale: CRITICAL retired-doc pointer (POL-016) + thin actuals + missing effective date. Needs Kevin input on multiple operational specifics and counsel review on privacy waiver.

---

### AGR-002 Laptop Acceptance Agreement

**File:** AGR-002_Laptop_Acceptance_Agreement_v1.0.txt
**Tracker status / version:** In review (v1.0) - Owner: HR (per manifest)
**Structure verdict (chunking probe):** FLAT-RISK - no heading-style markers; AGR class single-doc.

**Part 1 - Identification**
- id_from_filename: AGR-002
- id_in_document: AGR-002
- title_matches_tracker: yes
- version_in_document: v1.0 (Effective 6/12/2026)
- version_in_tracker: v1.0
- metadata_finding: No OWNER field in metadata block - all other batch docs carry it. Tracker says HR is owner. CRITICAL omission for AGR class. Also: jumps from SECTION 03 to SECTION 05 (no §04) - structural defect.

**Part 2 - Document-level**
- A1 Accuracy: PASS - operational responsibilities standard for a laptop AUP; IT vendor (Epoch IT) named with real contact info; 24hr report-window for lost/stolen aligns with industry baseline.
- A2 Actionability: PASS - signing party knows exactly what they're agreeing to; specific channels (Operations for issues, IT direct for tech support, PAF for replacements); named contacts.
- A3 Completeness/Actuals: PASS - vendor named (Epoch IT Solutions / Mike Murphy / phone / email); damage-responsibility tier defined; return-on-termination clause present.
- A4 Format/Metadata: ISSUES - **OWNER field missing from metadata block** (CRITICAL for AGR class - AGR-001 carries it). **Section numbering broken: §01, §02, §03, §05, §06 (no §04)** - either §04 was removed and headings not renumbered, or §04 content was merged into §03 / §05 and the section label was lost. **No ANCHOR statements with the right STD-001 syntax** - one ANCHOR-like statement with stray colon at top of §01 ("ANCHOR:"). **"NOTE :"** with stray colon in §03 (twice). Per STD-001 §11 AGR class anatomy: signature page IS present at §05 - correct. Related Documents block IS MISSING - References Map says AGR-002 should reference STD-001, AGR-001. CRITICAL omission.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: medium - the contact block for Epoch IT names a real person and phone; Sous could quote this confidently. That's fine if Mike Murphy is still the contact. Confirm.
  - chunking_readiness: FLAT-RISK - no heading-style markers; broken section numbering compounds risk.
  - number_hygiene: "24 hours" report window is real operational quantum. Phone numbers (847-800-9655, 224-377-9655) and email (mike@epochits.com, support@epochits.com) are real - Sous will quote them. Verify currency.

**Part 3 - Library checks**
- cross_refs_in_text: PAF (Personnel Action Form - not a doc ID, generic reference). Epoch IT Solutions (vendor, not a doc ID).
- inbound_retired_pointer: NO (no Related Documents block to check; vendor named instead)
- contradiction_within_doc: none structural beyond the missing §04
- terminology_drift: Mentions "HR" in §02 Data & Software ("explicit approval from HR or the Senior Director of Operations") - uses HR not People Operations. This is consistent with the convention list. Note: §07 of POL-009 (which pairs with this doc) escalates to Sr Dir Ops only; here HR OR Sr Dir Ops can approve - minor inconsistency worth surfacing.
- legal_flag: LEGAL-REVIEW: §02 Use & Access waiver of privacy expectation; §03 employee financial responsibility for damage; payroll deduction implications if KitchFix tries to recover damage cost from wages. State wage-deduction law applies. Counsel pass needed.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | Metadata | OWNER field missing from header block. All other AGR / POL docs carry it. STD-001 §10 requires owner as role title. | Add OWNER: Human Resources (or whichever role - tracker says HR). | yes - Kevin confirm |
| CRITICAL | Numbering | Section numbering jumps from §03 to §05 - missing §04. Either content lost or label lost. | Recover §04 content (likely was "Lost / Stolen / Damaged" or similar) or renumber §05 / §06 down to §04 / §05. Confirm intent. | yes - Kevin/HR confirm what was supposed to be in §04 |
| CRITICAL | End of doc | Related Documents block missing - STD-001 §11 requires it for AGR class. References Map shows AGR-002 should ref STD-001, AGR-001. | Add Related Documents block listing STD-001, AGR-001 (and POL-009 as pair). | no |
| MAJOR | §01 + §03 callouts | "ANCHOR:" / "NOTE :" with stray colons / space. STD-001 callout syntax (per other batch docs) is `ANCHOR` / `NOTE` on a clean line. | Sweep callout syntax. | no |
| MAJOR | §02 + §03 | Counsel review on privacy waiver and damage-cost recovery vs state wage-deduction law. | LEGAL-REVIEW. | no |
| MAJOR | Whole doc | No real Word heading styles - FLAT-RISK chunking. | Apply heading styles. | no |
| MAJOR | §03 vendor block | Epoch IT contact - confirm Mike Murphy is still the named contact. If he moves, Sous will quote a stale name. | Confirm contact currency; consider routing via support@epochits.com as primary to reduce person-dependency. | yes - Kevin confirm |
| MINOR | §02 vs POL-009 §07 | Approval authority drift: AGR-002 §02 = "HR or Senior Director of Operations"; POL-009 §07 = Sr Dir Ops only. | Reconcile - who's the actual approver for VPN / security exceptions? | yes - Kevin call |
| MINOR | §05 Acknowledgment | Has Signature / Date / Print Name / Date - the second "Date" is redundant (or one should be "Witness"). | Clean up signature block. | no |

**Part 5 - Catalog row draft**
- card_line: "What you're agreeing to when KitchFix issues you a laptop - care, return, and the financial responsibility line."
- summary: "AGR-002 is the signed agreement governing KitchFix-issued laptops. Defines use, care, data storage (Google Drive, not local), security tool restrictions, return on separation, and the employee financial responsibility for damage outside normal wear or KitchFix negligence. Names Epoch IT Solutions as IT vendor with current contact info. Replacements go through the PAF process."
- keywords: [laptop, AGR-002, Epoch IT, Mike Murphy, return on separation, Google Drive, VPN, monitoring, PAF, damage]
- shelf_proposed: Operations
- audience_proposed: corporate (laptop-issued employees, not hourly)
- status_proposed_opd_enum: In review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: NO - field missing
- approver_present: yes (Sr Dir Ops · 06/2026)
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: OWNER missing (CRITICAL); missing §04 (CRITICAL); Related Documents block missing (CRITICAL); LEGAL-REVIEW; vendor contact currency check; heading styles; card_line + summary.

**Part 7 - SME/actuals**
- SME: HR / Sr Dir Ops (Kevin) + Counsel
- Actual needed from Kevin: what was §04? - confirm intent. Confirm Owner. Confirm Epoch IT contact still current. Confirm approval authority (HR vs Sr Dir Ops) for VPN / security exceptions.

**Part 8 - Verdict**
- NOT-READY
- Rationale: Three CRITICAL structural defects (missing OWNER, missing §04, missing Related Documents). Plus counsel review on damage-recovery / privacy waiver and vendor contact verification.

---

### REF-003 Disciplinary Process Manager Quick Reference

**File:** REF-003_Disciplinary_Process_Manager_Quick_Reference_v1.0.txt
**Tracker status / version:** In review (v1.0) - Owner: HR
**Structure verdict (chunking probe):** FLAT-RISK - no heading-style markers; one-pager designed as a single chunk.

**Part 1 - Identification**
- id_from_filename: REF-003
- id_in_document: REF-003
- title_matches_tracker: yes (Disciplinary Process Manager Quick Reference)
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: NO metadata block at all. Header is title + "REF-003 · v1.0 · For use with SOP-004 Formal Disciplinary Process" only. Missing OWNER, APPROVED BY, NEXT REVIEW, CLASSIFICATION, EFFECTIVE date. CRITICAL for any class doc, though REF class one-pagers may have looser anatomy per STD-001 - confirm. Even so, owner + version + parent SOP pointer are needed.

**Part 2 - Document-level**
- A1 Accuracy: PASS (subject to verification against SOP-004) - this is the key check. The Four Levels table claims:
  - Level 1 Verbal Coaching - FORM-003 (manager signs only) - RDO same day
  - Level 2 Written Warning - FORM-004 - RDO same day, HR within 24hrs
  - Level 3 Final Written / Suspension - FORM-004 (marked Final) - RDO approval BEFORE issuing, HR notified
  - Level 4 Termination - FORM-006 - RDO + HR IMMEDIATELY
  - I do not have SOP-004 text in this batch to verify line-by-line. Based on References Map: FORM-003 = Level 1, FORM-004 = Levels 2-3, FORM-005 = PIP (§03), FORM-006 = Level 4. REF-003 here does NOT mention FORM-005 PIP - which is a notable omission since SOP-004 §03 invokes PIP. Could be intentional (PIP is its own track) or a thin spot.
- A2 Actionability: PASS - this is exactly what a manager needs at the moment of an incident. Clear table; "Always / Never" rules at end; zero-tolerance list explicit; "secure the situation, then call" is good operator wisdom.
- A3 Completeness/Actuals: ISSUES - FORM-005 PIP omitted (see A1). No PIP track means manager facing a chronic performance issue may not know to invoke PIP. Also: "Big Rules violations (AGR-001)" cites confidentiality, media, player info disclosure - those are subset of AGR-001 - confirm complete.
- A4 Format/Metadata: ISSUES - no metadata block (see Part 1). Missing Related Documents block - References Map confirms REF-003 implements SOP-004 so cross-ref to SOP-004, FORM-003, FORM-004, FORM-005, FORM-006, AGR-001 expected. Title-bar reference to SOP-004 is present but no footer block.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: HIGH-ISH - if Sous returns this BEFORE SOP-004, an operator may treat the one-pager as binding. The doc itself says "For use with SOP-004 Formal Disciplinary Process" but Sous chunk retrieval may not preserve that anchor. SOP-004 is binding source; REF-003 is the quick reference. The risk is that REF-003 is denser, more retrievable, and omits PIP - so a manager who Sous-searches "discipline level 3 PIP" may get REF-003 and miss the PIP track.
  - chunking_readiness: FLAT-RISK - no heading styles. Will chunk as one block, which for a one-pager is actually fine.
  - number_hygiene: "24hrs" appears - operational quantum, fine.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-004 (header reference - For use with SOP-004), FORM-003, FORM-004, FORM-006, AGR-001 (Big Rules)
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "HR" used (not "People Operations") - matches convention. References "RDO" by acronym - acceptable for manager audience. Tracker says SOP-004 owner = HR (which matches "HR within 24hrs" language).
- legal_flag: LEGAL-REVIEW: zero-tolerance termination list (esp. "Harassment - sexual, discriminatory, or hostile work environment conduct") needs counsel sign-off - some states require investigation-before-termination, not immediate termination, for harassment claims. Same caveat applies in SOP-004 (this doc inherits).

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | Header | No metadata block - missing OWNER, APPROVED BY, NEXT REVIEW, CLASSIFICATION, EFFECTIVE date. | Add metadata block per STD-001 §10 / §11 (REF class). | yes - Kevin confirm |
| CRITICAL | Footer | No Related Documents block. Should reference SOP-004, FORM-003, FORM-004, FORM-005, FORM-006, AGR-001. | Add Related Documents block. | no |
| MAJOR | Four Levels table | FORM-005 PIP not represented in the table. SOP-004 §03 invokes PIP per References Map; manager quick-ref omits it. If SOP-004 contradicts REF-003 on PIP, SOP-004 wins. | Confirm whether PIP is a fifth track or sits within Level 2 / Level 3. Add row or note. | yes - Kevin / HR confirm intent |
| MAJOR | Zero-Tolerance list | Counsel review on immediate-termination for harassment given state-law variation requiring investigation first. | LEGAL-REVIEW. | no |
| MAJOR | Top anchor | "For use with SOP-004 Formal Disciplinary Process" is the only contradiction-protection. Strengthen for Sous: a callout at top stating SOP-004 is binding source. | Add a CRITICAL-tagged top callout: "SOP-004 is the binding source. This is a manager quick reference. Where they differ, SOP-004 governs." | no |
| MAJOR | "Big Rules violations (AGR-001)" | Lists subset (confidentiality breach, media contact, player info disclosure). Confirm complete vs AGR-001 actual Big Rules. | Reconcile with AGR-001 §02 / §03 / §04 / §07. | no |
| MINOR | "RDO + HR IMMEDIATELY" wording | "IMMEDIATELY" in all caps - intentional emphasis for a one-pager. Acceptable per STD-001 §11 CRITICAL callout convention. | None. | no |

**Part 5 - Catalog row draft**
- card_line: "Manager one-pager for KitchFix discipline - the four levels, the forms, who to notify, and the zero-tolerance list."
- summary: "REF-003 is the manager quick reference for SOP-004 Formal Disciplinary Process. It maps the four discipline levels (Verbal Coaching, Written Warning, Final Written / Suspension, Termination) to the right form (FORM-003, FORM-004, FORM-004 Final, FORM-006) and the right notify path (RDO same day, HR within 24hrs, RDO + HR immediately on termination). Lists zero-tolerance violations (Big Rules per AGR-001, theft, fighting, intoxication, gross food safety, harassment). Manager rules summarized as Always / Never. SOP-004 is the binding source - this is a memory aid."
- keywords: [discipline, write-up, FORM-003, FORM-004, FORM-006, termination, zero tolerance, RDO, harassment, AGR-001 Big Rules, SOP-004]
- shelf_proposed: HR & People
- audience_proposed: operator (manager-tier specifically)
- status_proposed_opd_enum: In review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes (v1.0)
- card_line_present: no
- owner_present_role_title: NO - no metadata block
- approver_present: NO
- summary_keywords_present: no
- chunking_ready_real_headings: NO (acceptable for one-pager)
- Blocks to Live: metadata block CRITICAL; Related Documents block CRITICAL; PIP gap; LEGAL-REVIEW on harassment immediate-termination; SOP-004-is-binding-source anchor.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + SOP-004 author + Counsel
- Actual needed from Kevin: confirm PIP intent (is it a fifth track? embedded in L2 / L3?); confirm AGR-001 Big Rules subset is complete.

**Part 8 - Verdict**
- NOT-READY
- Rationale: Missing metadata block + missing Related Documents block (CRITICAL). PIP omission is a substantive gap. SOP-004-binding-source anchor needed for Sous protection. Counsel review on harassment-as-zero-tolerance.

---

### FORM-001 Refusal of Medical Treatment

**File:** Refusal_of_Medical_Treatment_FORM-001_v1_0.txt
**Tracker status / version:** Live (v1.0) - Owner: HR
**Structure verdict (chunking probe):** FLAT-RISK by extraction probe (no heading markers) - but THIN is acceptable for FORM class per batch B context (single-page form).

**Part 1 - Identification**
- id_from_filename: FORM-001
- id_in_document: FORM-001
- title_matches_tracker: yes
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: Header is title + "FORM-001 · v1.0 · KitchFix Internal — HR Confidential" + parent SOP reference. Missing explicit OWNER, APPROVED BY, NEXT REVIEW. For a FORM class doc this lighter header is structurally acceptable per "single-page form" intent in batch context. MINOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - structurally is a refusal form with witness signature; refusal language is standard "release of liability" wording. The "release KitchFix Performance Food Service, its employees, and the Club from liability" clause is counsel-territory but as written it's standard-form.
- A2 Actionability: PASS - sections are clearly numbered (1. Affected Person, 2. Incident, 3. Treatment Offered, 4. Refusal Statement, 5. Signatures, 6. HR Receipt); fields a non-medical witness can complete; clear "submit to HR within 24 hours" instruction at top.
- A3 Completeness/Actuals: PASS - actuals are field placeholders (correct for a form). Refusal-statement language is complete and legally substantive. Witness role and HR receipt sections present.
- A4 Format/Metadata: PASS for FORM class - intentionally light. Top line includes parent SOP reference ("Reference: SOP-002 §7.1, Appendix C"). Missing dedicated Related Documents footer block (References Map shows FORM-001 references SOP-002 §7.1, Appendix C - which is in the top line already).
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: HIGH - this is a fillable form. Sous retrieval will surface refusal-statement text as if it were policy ("I voluntarily refuse..."). For form-class docs, the safest path is the STUB approach (do NOT extract body content into the corpus; let the form sit as a metadata pointer). This is the recommended path per Pass 1 thinking on form-class docs.
  - chunking_readiness: FLAT-RISK - no heading styles, but acceptable for a one-pager.
  - number_hygiene: "24 hours" submission window is real operational quantum. No placeholder figures Sous would misquote.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-002 §7.1, SOP-002 Appendix C (top reference line)
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "HR Confidential" classification and "Human Resources" used at "Submit to Human Resources within 24 hours" - matches convention. Uses "Human Resources" not "People Operations" - GOOD. References "the Club" in refusal statement - confirm this is intentional club / MLB-team language for the liability release.
- legal_flag: LEGAL-REVIEW: Refusal statement and liability-release language. Counsel should sign off. "Release of liability" language varies by state on enforceability; in some states a release of negligence claims for workers' comp injuries is void as against public policy. Worth a counsel pass.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Refusal statement | Liability-release language ("release ... from liability") is counsel territory. State-by-state enforceability varies. Form is live - assume counsel approved at v1.0 but worth re-confirming. | LEGAL-REVIEW; confirm counsel signed off on v1.0. | no |
| MAJOR | SousAI loading | Form-class doc - body content (refusal statement) will misload as policy if extracted. Take STUB path (metadata pointer only). | Configure SousAI to stub this doc. Do not chunk the refusal-statement text. | no |
| MINOR | Metadata | No explicit OWNER / APPROVED BY / NEXT REVIEW lines (acceptable for FORM class but worth standardizing). | Optional: add a lightweight metadata strip for tracker hygiene. | no |
| MINOR | Refusal statement | "the Club" capitalized in refusal but never defined in the form. For non-MLB accounts (corporate, PDC), confirm wording substitution. | Consider neutral "Client" or define "the Club" in header. | yes - Kevin call on multi-account variant |
| MINOR | Top reference line | "Reference: SOP-002 §7.1, Appendix C" - confirm Appendix C of SOP-002 still references this form (avoids broken pointer if SOP-002 reorders). | Periodic check. | no |

**Part 5 - Catalog row draft**
- card_line: "What an employee signs when they decline medical treatment after a workplace injury - the witness-signed refusal form."
- summary: "FORM-001 is the KitchFix refusal-of-medical-treatment form, used when an employee or affected person declines offered medical treatment after a workplace injury or incident. Captures incident details, the treatment that was offered, a signed refusal statement, witness signature from a KitchFix representative, and an HR receipt section. Referenced by SOP-002 §7.1 and Appendix C. Submit to Human Resources within 24 hours."
- keywords: [refusal, medical treatment, incident, FORM-001, SOP-002, witness, HR, liability release, 24 hours]
- shelf_proposed: Safety
- audience_proposed: operator (specifically site triad / witness)
- status_proposed_opd_enum: Live (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: implicit (HR Confidential classification + HR submission)
- approver_present: NO (no explicit line)
- summary_keywords_present: no
- chunking_ready_real_headings: NO (acceptable for FORM class)
- Blocks to Live: form is already Live in tracker. For Sous: stub path. For LIVE staging: optional metadata strip and counsel re-confirmation on liability release.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Counsel
- Actual needed from Kevin: multi-account "the Club" variant; counsel sign-off confirmation.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Already Live per tracker. Form is operator-actionable. Sous treatment must be STUB-path to avoid misloading refusal language. Counsel re-confirmation on liability release recommended but not blocking.

---

## Cross-batch observations

### Patterns across Batch B

1. **People Operations vs Human Resources terminology drift is a cross-batch pattern.** Four of five POLs (POL-001, POL-002, POL-004, POL-006-ES) use "People Operations" / "Operaciones de Personal" as owner and inline. Convention list says "Human Resources." FORM-001 and AGR-002 use "HR" / "Human Resources" correctly. REF-003 uses "HR" correctly. So the pattern splits along ownership: HR-owned policies often use "People Operations" inline. Kevin should make the canonical call (likely "Human Resources" per convention list). This is also flagged in MEMORY as the "OPD owner-field convention sweep" - 11 docs deferred to their own per-doc batch. Re-confirming the pattern here.

2. **FLAT-RISK chunking is universal in this batch.** All 7 docs scored for SousAI corpus (excluding POL-006-ES) lack Word heading styles. The "SECTION 01" text is paragraph text, not Heading 1. Production chunking will be poor without fix. This is the single biggest pre-Live blocker across the batch and is consistent with the manifest's FLAT-RISK call for every batch B doc.

3. **POL-016 is referenced as Live by POL-009 - CRITICAL.** POL-016 (Record Retention & Destruction) is RETIRED with no superseding doc per manifest. This is a GAP that needs Kevin's call: either author a successor or change the POL-009 pointer to something else (Rippling? Drive retention settings?). This is the only retired-doc pointer found in Batch B.

4. **Counsel review needed for almost every POL in this batch.** POL-001 (anti-retaliation), POL-002 (pay-deduction + accommodation), POL-004 (NCNS-as-resignation + protected leave), POL-006-ES (paired with EN POL-006), POL-009 (privacy / monitoring waiver), AGR-002 (damage-recovery + privacy), REF-003 (harassment-as-zero-tolerance), FORM-001 (liability release). State-law variation across 8 states (AZ, FL, IL, KY, MO, NY, OH, TX) compounds this. Recommend a single counsel pass on the HR / IT / Discipline doc cluster.

5. **Three docs have CRITICAL structural defects:**
   - POL-002 missing Related Documents block
   - AGR-002 missing OWNER, missing §04, missing Related Documents block
   - REF-003 missing metadata block, missing Related Documents block
   - These are the highest-priority Live blockers in the batch.

6. **Site Leader vs Site Manager naming drift.** POL-004 uses "Site Leader" consistently; POL-002 uses "Site Manager" and "site manager." STD-001 / PB-001 should canonize. Suspect PB-001 v9.1 uses "Site Leader" (matches POL-004) - confirm.

7. **Status-label drift in Related Documents blocks.** POL-001 lists STD-001 as "Live (v1.0)" but tracker has v1.1. POL-001 lists PB-004 as "Live (v1.0)" but tracker has "In review (v1.2)." This is the "point-don't-duplicate" rule misapplied - by including a version, the policy becomes stale every time the referenced doc bumps. Convention should be: just the ID + title + status keyword ("Live" / "Referenced"). Recommend a global edit pass to strip version numbers from Related Documents tables.

8. **PIP gap in REF-003.** SOP-004 §03 invokes PIP (FORM-005). REF-003's Four Levels table omits it. Could be intentional (PIP is parallel track, not a level) or a thin spot. Kevin / HR should confirm.

9. **REF-003 metadata is the leanest in the batch** - REF class one-pager but no metadata block at all. Even a single-line metadata strip would help tracker hygiene and SousAI confidence.

10. **POL-006-ES is the cleanest doc structurally in the batch** (well-formed TOC, callouts, Related Documents). Ironically, it is the doc explicitly excluded from the Sous corpus. The English POL-006 (not in this batch) should be checked for parity.

### Items for main session synthesis

- Pattern (1), (6), (7) suggest a single Pass 5 sweep: terminology + status-label cleanup across the HR doc cluster.
- Pattern (3) is the highest-priority single fix: POL-016 retired-pointer remediation.
- Pattern (4) suggests bundling a counsel pass on the HR / IT / Discipline cluster - not chasing counsel one doc at a time.
- Pattern (2) is the same fix Kevin already knows about (apply Word heading styles to all POL / AGR / REF docs); confirming it's universal in batch B.
