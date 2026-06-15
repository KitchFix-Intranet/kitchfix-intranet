# Batch C Scorecards - SOP + CHK + TPL cluster

**Batch:** C (9 docs - SOP-004, SOP-005, SOP-008, SOP-010, SOP-012, SOP-014, SOP-015, CHK-003, TPL-019)
**Scorer:** scoring subagent
**Date:** 2026-06-14
**Mode:** Pass 1 read-only, structured findings per RUBRIC_PACK.md §6

---

### SOP-004 Formal Disciplinary Process

**File:** SOP-004_Formal_Disciplinary_Process_v1.0.docx
**Tracker status / version:** In review (v1.0) - Owner HR
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-004
- id_in_document: SOP-004 (stated in metadata block)
- title_matches_tracker: YES ("Formal Disciplinary Process")
- version_in_document: v1.0, Effective 6/12/2026
- version_in_tracker: v1.0
- metadata_finding: Owner field stated as "Human Resources" (department) rather than a role title - violates STD-001 §10 (owner must be role title, never personal name; department is not a role title). Confirms the OPD owner-field convention sweep noted in user memory.

**Part 2 - Document-level**
- A1 Accuracy: PASS - four-level progressive discipline scheme is internally coherent; immediate-termination triggers map cleanly to AGR-001 violations. Statement that disciplinary records retained "minimum of three years" needs counsel review against state-specific record-retention requirements.
- A2 Actionability: PASS - clear who acts, what form is used, who is notified. Authority Matrix at §05 is operator-readable. Each level names the form (FORM-003/004/005/006) and the notification chain. EC-readable.
- A3 Completeness/Actuals: PASS - the system is specific (forms, timelines, signature mechanics, witness mechanics for refusal). Mariela Chavez named as People Operations contact at §05 is operational. PIP standard 30 days, 60-day option named.
- A4 Format/Metadata: ISSUES - owner = "Human Resources" not a role title (STD-001 §10 violation - MAJOR). No Contents block visible (per RUBRIC §1 Part 6 a SOP should have TOC - check). No Version History section visible. Approver = "SLT + People Operations · 06/2026" (acceptable - body, not personal name). Authority Matrix at §05 reads as a flat block of role/cell pairs in extract - may render correctly in Word but chunking-flat-risk in extract.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO (this is a process SOP not a template). chunking_readiness: No `[H1]` / `[H2]` / `[H3]` style markers in extract - structure relies on "SECTION 01" / "SECTION 02" headers which may or may not be real Word styles. FLAT-RISK per manifest. number_hygiene: "three years" retention; "1-3 days" suspension; "five business days" review request; "30 days / 60-day option" PIP - all should be confirmed against counsel and state law before live.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-002 (§01 NOTE, Related Documents) - status: Live (v1.3)
  - POL-001 (§01 NOTE, §07, Related Documents) - status: Pending
  - AGR-001 (§01 NOTE, §04 trigger, Related Documents) - status: Live
  - FORM-003 (§02 L1, §06, Related Documents) - Live (v1.0)
  - FORM-004 (§02 L2, L3, §06, Related Documents) - Live (v1.0)
  - FORM-005 (§02 L3 PIP, §06, Related Documents) - Live (v1.0)
  - FORM-006 (§02 L4, §06, Related Documents) - Live (v1.0)
  - REF-003 (Related Documents) - Live (v1.0)
  - STD-001 (Related Documents) - Live (v1.0)
- inbound_retired_pointer: NO - no pointers to the retired set
- contradiction_within_doc: none
- terminology_drift: "People Operations" used throughout (vs the convention list "Human Resources"). Owner field is "Human Resources" but body text uses "People Operations." This is a known KitchFix terminology drift and consistent with what's flagged across the doc set; flag as MINOR for tracking.
- legal_flag: LEGAL-REVIEW - §02 (suspension without pay - state wage-hour interplay), §04 (immediate termination triggers - state at-will / final pay timing), §06 (3-year retention floor - varies by state), §07 (employee right to review within 5 business days - aligns with anti-retaliation expectations but counsel should confirm). Manifest already tags this doc as "Counsel review."

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | Owner = "Human Resources" (department), not a role title; violates STD-001 §10 | Set Owner to a role title (e.g., "Director, People Operations" or "VP Operations") | Yes - confirm correct role title with Kevin |
| MINOR | §01 NOTE + §05 + §06 body | "People Operations" used inconsistently with metadata field "Human Resources"; pick one canonical term across the OPD library | Decide and sweep; this is library-wide cleanup | Yes - Kevin/Mariela canonical name |
| MINOR | §02 / §06 | No Contents/TOC block detected in extract; SOP class per STD-001 §11 should have TOC | Confirm TOC exists in the Word file; if absent, add | No |
| MINOR | §06 | "minimum of three years" retention - state law varies | Confirm per state or add reference to a counsel-vetted retention schedule | Yes - counsel |
| MINOR | §02 L4 | "submits separation PAF on the intranet same day" - intranet (Ops Hub) is the system of record for separations; confirm route is live | Confirm PAF separation form is live in the intranet | Yes - Kevin |
| LEGAL-REVIEW | §02 §04 §06 §07 | Discipline mechanics, immediate termination triggers, retention floor, review window need counsel sign-off pre-live | Counsel review | Yes - counsel |

**Part 5 - Catalog row draft**
- card_line: "The four-level progressive discipline system - verbal, written, final/suspension, termination - and which form to use at each level."
- summary: "Defines KitchFix's progressive discipline process for all employees across all accounts. Four levels (verbal coaching, written warning, final written or suspension, termination) with the form, notification, and authority matrix for each. Names the immediate-termination triggers (Big Rules violations, theft, fighting, intoxication, gross food-safety, harassment). Routes harassment/discrimination/EEO out to the handbook. Cross-refs POL-001, POL-002, AGR-001 and FORM-003/004/005/006/REF-003."
- keywords: discipline, progressive discipline, written warning, PIP, suspension, termination, immediate termination, coaching, FORM-004, FORM-005
- shelf_proposed: HR & People
- audience_proposed: corporate (and EC-facing for execution)
- status_proposed_opd_enum: In Review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no (this is a draft for catalog)
- source_drive_id_present: n/a
- owner_present_role_title: NO - "Human Resources" is a department, not a role title (block)
- approver_present: yes (SLT + People Operations · 06/2026)
- summary_keywords_present: no (drafted here)
- chunking_ready_real_headings: unknown - extract shows "SECTION NN" plain-text not [H1]/[H2]/[H3]; FLAT-RISK per manifest
- blocks_to_live: owner-field fix; counsel review; POL-001 dependency status; intranet PAF route confirmation; TOC confirmation

**Part 7 - SME/actuals**
- SME: HR (Mariela), Counsel
- Actual needed from Kevin: confirm the canonical role title for owner; confirm intranet separation PAF route is live; confirm the People Operations vs Human Resources naming convention sweep

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: The four-level system is operationally clean and the forms map to it cleanly. Two blocks before live: owner-field role-title fix (MAJOR per STD-001 §10) and a counsel pass on retention, immediate-termination triggers, and suspension wage interactions.

---

### SOP-005 Onboarding Process SOP

**File:** SOP-005_Onboarding_Process_SOP_v1_0.docx
**Tracker status / version:** Queued (per tracker; file present) - Owner HR
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-005
- id_in_document: SOP-005
- title_matches_tracker: YES ("Onboarding Process SOP")
- version_in_document: v1.0 Draft
- version_in_tracker: Queued (no version per manifest); file present is v1.0
- metadata_finding: Owner field is BLANK in the document metadata block (line 29 shows "OWNER" header followed by "CLASSIFICATION" with no value between). MAJOR. Approved By = "Pending - HR + SLT". This is a clear draft state per the tracker reconciliation.

**Part 2 - Document-level**
- A1 Accuracy: PASS - I-9 timing referenced "within the legal window" (correct hedge given AZ E-Verify open question). No food-safety temps to check directly here. Cross-refs to PB-007/SOP-002 for safety orientation are correct.
- A2 Actionability: PASS - five stages with owners and finish lines. Day 1 section has a numbered 5-step list. Knife-skills verification gate explicit at §05 (FORM-009 + cut-glove rule). EC-readable.
- A3 Completeness/Actuals: ISSUES - thin spots: "Owned by the hiring manager / Executive Chef" without a specific RACI; §08 90-day check-in references TPL-004 (Staged per manifest, not live). §02 timeline table is high-level - no concrete-hour estimate, no first-shift expectations. "First week" finish line undefined ("food-safety and role training; knife-skills verification before solo line work") - operationally clear but no SLA.
- A4 Format/Metadata: ISSUES - Owner field blank (MAJOR per STD-001 §10). Contents block present. Approved By "Pending" appropriate for Draft. NEXT REVIEW "Annual" but no date stamp visible. Body section structure looks reasonable in extract.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO. chunking_readiness: extract shows "SECTION 01" header style and Contents block - structure exists but no `[H1]` markers visible in extract; FLAT-RISK per manifest. number_hygiene: "90-day mark" - this is a real plan timeline; "first week" - undefined.

**Part 3 - Library checks**
- cross_refs_in_text:
  - TPL-016 Onboarding Checklist (§01, §06, §08, Related Docs) - Queued per manifest (gated on SOP-005 / SOP-001 v2.1)
  - PB-013 Training & Certification Program (§01, §05, Related Docs) - "In review" but manifest says "Not started" with file present (reconciliation question already flagged)
  - AGR-001 (§03, §04, Related Docs) - Live
  - AGR-002 (§03) - In review
  - PB-010 Site Operations Manual (§04) - Draft per manifest
  - REF-002 Uniform Standards Catalog (§04) - Live not in Doc Set 1 per manifest
  - POL-002 (§04) - In review
  - PB-007 (§04) - In review
  - SOP-002 (§04) - Live
  - SOP-008 (§05) - In review
  - PB-002 (§05) - Live
  - FORM-009 (§05, Related Docs) - In review
  - TPL-004 90-Day WOW Plan (§08, Related Docs) - Staged
  - POL-013 (Related Docs) - In review
  - POL-012 (§03 NOTE: "see POL-012, on hold") - **RETIRED / ON HOLD** per manifest
  - STD-001 (Related Docs) - Live (v1.1)
- inbound_retired_pointer: YES - §03 NOTE explicitly cites POL-012 ("on hold") as the parking lot for the E-Verify question. POL-012 status per manifest is "On hold - AZ E-Verify compliance pending" and is listed in the retired set table as "On hold (no super, ID reserved)." The reference is hedged ("on hold") rather than as if current - so this is borderline rather than a clean CRITICAL. Flag MAJOR (not CRITICAL) because the cross-ref status is honestly labeled as on-hold, not "Live." Confirm with Kevin whether on-hold pointers are acceptable or should be removed entirely until the policy is published.
- contradiction_within_doc: none
- terminology_drift: §07 uses "Human Resources" (consistent with body); no "People Operations" drift in this doc.
- legal_flag: LEGAL-REVIEW - §03 (I-9 timing; E-Verify; AZ mandate) - the doc itself flags this for counsel; record-of-finding only.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | Owner field blank between "OWNER" and "CLASSIFICATION" rows | Populate with role title per STD-001 §10 | Yes - confirm with Kevin |
| MAJOR | §03 NOTE | References POL-012 as if it's a current parking lot for E-Verify; POL-012 is on hold/retired-adjacent per manifest | Either remove the pointer or restate as "policy to be authored - track in CK-2" | Yes - Kevin |
| MINOR | Approved By | "Pending - HR + SLT" - acceptable for Draft state but flags doc is not yet approved | Approval cycle | No |
| MINOR | §02 / §08 | TPL-004 (90-Day WOW Plan) referenced but Staged not live | Confirm TPL-004 status before SOP-005 goes live; or rewrite §08 to not depend on TPL-004 | Yes - tracker reconcile |
| MINOR | §05 + Related Docs | SOP-008 referenced as Related; SOP-008 itself is In Review - confirm doc dependencies are sequenced | Sequence approvals so SOP-005 doesn't go live before its dependencies | No |
| MINOR | §01 / §06 | "PB-013" referenced as training & certification program - PB-013 status per manifest is Not started (file present) - reconciliation question | Confirm PB-013 reality before SOP-005 goes live | Yes - tracker reconcile |
| MINOR | §05 | "ServSafe Food Handler" referenced - if cert tracking lives in Rippling and REF-009 (ServSafe Cert Tracker) is retired, ensure no later edit reintroduces REF-009 pointer | Note for librarian to watch | No |
| LEGAL-REVIEW | §03 | I-9 / E-Verify / AZ mandate - already flagged in doc body | Counsel review | Yes - counsel |

**Part 5 - Catalog row draft**
- card_line: "How a new KitchFix hire goes from accepted offer to a fully trained, station-ready team member - same way, every time."
- summary: "Defines the five-stage onboarding path (offer accepted, pre-boarding, day one, training & verification, 90-day mark) for every KitchFix new hire. Pre-boarding is Rippling-driven (record, I-9, tax, direct deposit, policy package). Day one is owned by the EC and covers Big Rules, policy acks, uniform, safety orientation. Training section sets the knife-skills verification gate (FORM-009, cut-glove rule) before solo station work. 90-day check uses TPL-004 framework. Onboarding Checklist (TPL-016) is the single tracking tool."
- keywords: onboarding, new hire, pre-boarding, day one, I-9, Rippling, knife skills, FORM-009, 90-day, TPL-016
- shelf_proposed: HR & People
- audience_proposed: corporate + EC (both)
- status_proposed_opd_enum: In Review (Draft - per tracker Queued / file in v1.0)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- source_drive_id_present: n/a
- owner_present_role_title: NO (blank)
- approver_present: NO ("Pending")
- summary_keywords_present: no
- chunking_ready_real_headings: unknown - structure looks better than other FLAT-RISK docs; SECTION/Contents pattern visible
- blocks_to_live: owner field, approver, POL-012 pointer resolution, TPL-016 status (gating dependency), PB-013 reconciliation, dependent SOP-008/AGR-002/PB-007 approvals, counsel review of pre-boarding

**Part 7 - SME/actuals**
- SME: HR (Mariela), Counsel (for I-9/E-Verify)
- Actual needed from Kevin: owner role title; whether on-hold pointer to POL-012 is acceptable in print or needs removal; TPL-016 readiness signal; confirm PB-013 reality.

**Part 8 - Verdict**
- NOT-READY
- Rationale: Missing owner field; pending approval; depends on TPL-016 (Queued/gated on this SOP - circular); depends on PB-013 reconciliation; counsel pass needed on E-Verify; POL-012 pointer needs resolution.

---

### SOP-008 Food Safety Management

**File:** SOP-008_Food_Safety_Management_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner Director of Culinary
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-008
- id_in_document: SOP-008
- title_matches_tracker: YES ("Food Safety Management")
- version_in_document: v1.0 Draft
- version_in_tracker: v1.0
- metadata_finding: Owner = "Director of Culinary" (role title - PASS per STD-001 §10).

**Part 2 - Document-level**
- A1 Accuracy: PASS - canonical temps consistent: 135F hot / 41F cold (used in §04, §05, §06, §07). Cook temps standard (165 / 155 / 145 / 135). Cooling clock standard (135->70 in 2h, 70->41 in 4h). TPHC 4-hour clock. Shellstock 90-day retention. Date-mark max 7 days at 41F. Three-comp sink wash 110F+. Hi-temp dish machine 180F manifold (~160F dish surface). Quat 200-400 ppm. Big 6 illnesses correctly named (Norovirus, Hep A, Shigella, STEC, S. Typhi, nontyphoidal Salmonella). All these track FDA Food Code / ServSafe.
- A2 Actionability: PASS - 14 well-scoped sections; specific PIC duties at open/service/close; storage order numbered list; cook temp table; corrective actions are concrete ("discard," "remake," "move product"). Cook-readable with allowance for ESL noting some long sentences.
- A3 Completeness/Actuals: PASS - this is the most complete doc in the batch. Specifies thermometer calibration methods (ice-point 32F, boiling-point 212F adjusted for altitude). The note that microwaves are not used for player food is a real KitchFix operating reality.
- A4 Format/Metadata: ISSUES - Contents present. Section structure consistent. No Version History section in extract (SOP-class per STD-001 §11 should have one). Section headings "SECTION 01" plain text - chunking flat-risk noted in manifest.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO (this is the canonical food-safety SOP - Sous SHOULD retrieve from this). chunking_readiness: extract shows reasonable section structure but no `[H1]` markers in extract - FLAT-RISK noted in manifest. This is the most critical doc to get heading-styled in Word so Sous can chunk by §02-§14 cleanly. number_hygiene: every number is operationally load-bearing and FDA-Food-Code aligned. "Typically 200-400 ppm" quat - the "typically" is a hedge against vendor variation, acceptable.

**Part 3 - Library checks**
- cross_refs_in_text:
  - PB-002 Allergen Playbook (§09, Related Docs) - Live
  - PB-004 Hourly Employee Handbook (§03, Related Docs) - In review
  - SOP-002 Safety & Incident Management (§14, Related Docs) - Live
  - SOP-004 Formal Disciplinary Process (§14, Related Docs) - In review
  - TPL-018 Daily Food Safety Log (§04, §06, §07, §10, §13, Related Docs) - **In review per manifest; NOT IN DOC SET 1**
  - CHK-003 Health Inspection Readiness (Related Docs) - In review
  - POST-003 Kitchen Safety Posting (Related Docs) - In review
  - STD-001 (Related Docs) - Live
- inbound_retired_pointer: NO - no retired-set references.
- contradiction_within_doc: none. Hot 135F / cold 41F consistent every reference. Cool 135->70 in 2h / 70->41 in 4h consistent.
- terminology_drift: none significant. Uses "Person in Charge / PIC" canonically. "Director of Culinary" as role title aligns with PB-001 conventions.
- legal_flag: LEGAL-REVIEW (light) - §11 "Big 6" exclusion list and "doctor's or health-department clearance before return" should be reviewed against state health-department rules and ADA-interactive accommodation logic. Manifest does not flag SOP-008 for counsel but the Big-6 exclusion ties into employment law.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Multiple sections | TPL-018 Daily Food Safety Log is referenced as the single consolidated log (§04, §06, §07, §10, §13) but TPL-018 is "In review, file not in Doc Set 1" per manifest. Cannot ship SOP-008 live until TPL-018 file is reconciled and visible. | Locate TPL-018 file; resolve manifest reconciliation item #7 | Yes - tracker reconcile |
| MINOR | Metadata | No Version History section detected in extract (SOP-class should have one per STD-001 §11) | Add Version History | No |
| MINOR | §03 | "every KitchFix food handler holds a current ServSafe Food Handler and ServSafe Allergen certification, per PB-004" - if cert tracking lives in Rippling and REF-009 retired, ensure later edits don't introduce a REF-009 pointer | Note for librarian | No |
| MINOR | §10 | "warewashing machine final sanitizing rinse reaches 180F at the manifold (about 160F at the dish surface)" - confirm this matches FDA Food Code 4-501.112 expectation (160F utensil surface). The numbers track FDA Food Code; just confirm during print review. | Confirm | No |
| MINOR | §12 | "Deep, vendor-specific pest-control procedures may live in a separate SOP" - this is the satellite-doc pointer to SOP-012. Could be explicit: "see SOP-012 Pest Control & IPM." | Add explicit pointer | No |
| MINOR | §11 | "Big 6" exclusion + clearance language; counsel should validate against state health requirements + ADA | Counsel light pass | Yes - counsel |
| MINOR | §13 | TPL-018 named as the consolidated daily log; the SOP describes its contents in detail - if TPL-018 design drifts, SOP-008 §13 becomes stale | Tight version-lock between TPL-018 and SOP-008 §13 | No |
| LEGAL-REVIEW | §11 | Employee health exclusion + Big-6 illness clearance interplay with ADA / state health | Counsel light pass | Yes - counsel |

**Part 5 - Catalog row draft**
- card_line: "The complete food-safety management program for every KitchFix kitchen - source to service, the temperatures, times, and controls that keep food safe."
- summary: "KitchFix's food-safety management system, built on FDA Food Code, ServSafe, and HACCP. Defines active managerial control, the five risk factors, PIC accountability, approved sources and receiving (cold ≤41F, hot ≥135F), storage order (raw protein below ready-to-eat), date marking (7-day max at 41F), approved thawing methods (no room-temp thaw), cook temps (165/155/145/135), cooling (135->70 in 2h / 70->41 in 4h), holding (hot ≥135F, cold ≤41F), TPHC 4-hour clock, thermometer calibration, cross-contam and allergen rules (deferring to PB-002), three-comp sink and warewashing standards, quat sanitizer 200-400 ppm, hygiene and Big-6 exclusion, pest IPM and water/plumbing, the consolidated Daily Food Safety Log (TPL-018), and the incident/recall reporting chain that routes to SOP-002 and SOP-004."
- keywords: food safety, FDA food code, ServSafe, HACCP, temperature, danger zone, 135F, 41F, cooling, TPHC, allergen cross-contact, quat sanitizer, PIC, person in charge, big 6, foodborne illness
- shelf_proposed: Safety (or Culinary - this doc sits at the intersection; Safety reads as the protective-of-guest angle which aligns with the brand promise. Culinary OS would also be reasonable. Suggest Safety.)
- audience_proposed: operator (frontline EC/cook readable) + corporate (governance)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- source_drive_id_present: n/a
- owner_present_role_title: yes (Director of Culinary)
- approver_present: yes (SLT + Director of Culinary - but doc still Draft v1.0)
- summary_keywords_present: no
- chunking_ready_real_headings: unknown - structure visible in extract; FLAT-RISK per manifest. CRITICAL to get H1/H2/H3 styles applied for Sous chunking.
- blocks_to_live: TPL-018 file reconciliation (#7 from manifest); chunking-style sweep; light counsel pass on §11 Big-6 / exclusion

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary); Counsel (light pass on §11)
- Actual needed from Kevin: TPL-018 location and lock the SOP-008 §13 ↔ TPL-018 content contract; confirm warewash 160F dish-surface number against site machine specs.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Substantively the strongest doc in this batch and FDA-Food-Code aligned. Two practical blocks: TPL-018 file reconciliation and heading-styles for Sous chunking. Counsel pass on §11 Big-6 is light-touch.

---

### SOP-010 Driver / Fleet Safety

**File:** SOP-010_Driver_Fleet_Safety_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner HR
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-010
- id_in_document: SOP-010
- title_matches_tracker: YES ("Driver / Fleet Safety")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: Owner = "Human Resources" (department, not a role title). Violates STD-001 §10. MAJOR.

**Part 2 - Document-level**
- A1 Accuracy: PASS - "Refrigerated or hot-held food is transported per SOP-008 - the cold or hot chain does not break in transit" correctly anchors to SOP-008 for the temps. Accident response 911-first / S1 logic aligns with SOP-002 severity framework.
- A2 Actionability: PASS - daily inspection list is operator-actionable. Six-step accident-response table is clear. Maintenance & Records section is brief but covers the essentials.
- A3 Completeness/Actuals: ISSUES - "Acceptable motor-vehicle record" undefined (operational thin spot - what is acceptable? - threshold not stated). "Periodically after" undefined. "Scheduled maintenance plan" undefined (frequency / vendor / system of record). REF-008 referenced as the records system but REF-008 is RETIRED per manifest.
- A4 Format/Metadata: ISSUES - owner field is department not role title (MAJOR per STD-001 §10). No Contents/TOC block in extract (SOP-class per STD-001 §11 should have TOC). No Version History.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO. chunking_readiness: FLAT-RISK per manifest; section headers plain text. number_hygiene: no specific dollar/date/figure to flag - this doc is light on numbers.

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-002 (§01, §05, Related Docs) - Live
  - PB-007 (Related Docs) - In review
  - POL-003 (§02, Related Docs) - In review (v1.1)
  - REF-008 Permit & License Tracker (§06, Related Docs) - **RETIRED** per manifest. Superseded by POL-019.
  - SOP-008 (§03, Related Docs) - In review
  - STD-001 (Related Docs) - Live
- inbound_retired_pointer: **YES - CRITICAL.** §06 ("Maintenance & Records") says "Registration, insurance, and any required commercial permits stay current (tracked in REF-008)" and Related Documents block lists REF-008 as Live. REF-008 is RETIRED per manifest and was reclassified to **POL-019 Permit & License Compliance Policy** (In review per manifest). This is a clear retired-set pointer treated as live.
- contradiction_within_doc: none
- terminology_drift: minor - uses "Human Resources" canonically (no "People Operations" drift)
- legal_flag: LEGAL-REVIEW - §02 "license suspension, DUI, or major violation reported immediately" and §02 motor-vehicle record screening interplay with state DMV / EEOC adverse-action rules. §05 "Never admit fault" is standard but counsel should bless. Insurance-carrier requirements (also addressed in SOP-002 §07.2 / FORM-002) should be coordinated.

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | §06 + Related Docs | References REF-008 (Permit & License Tracker) as Live; REF-008 is RETIRED, superseded by POL-019 | Repoint to POL-019; update Related Docs status | No - rule applies |
| MAJOR | Metadata | Owner = "Human Resources" (department), not role title; violates STD-001 §10 | Set Owner to role title (Director, People Operations) | Yes - Kevin |
| MAJOR | §02 | "Acceptable motor-vehicle record" undefined - operational vagueness; this is a thin spot for hourly delivery drivers | Define acceptable MVR thresholds (e.g., no DUI within X years, max moving violations) | Yes - HR/insurance carrier |
| MAJOR | §02 | "Driving record - checked before authorization and periodically after" - "periodically" undefined | Set explicit cadence (e.g., annually, post-incident) | Yes - HR |
| MINOR | §06 | "Scheduled maintenance plan" undefined - no frequency, no system of record | Name the system (vendor, mileage trigger, etc.) | Yes - Kevin |
| MINOR | Metadata | No Contents/TOC block detected; SOP-class per STD-001 §11 should have TOC | Confirm in Word; add if absent | No |
| MINOR | §05 | Six-step accident-response table good; could explicitly cross-link to FORM-002 Vehicle Incident Worksheet (per References Map) | Add explicit FORM-002 pointer | No |
| MINOR | §05 | "Notify Human Resources and the VP of Operations" - role-titles canonical here; consistent with metadata | No fix needed | No |
| LEGAL-REVIEW | §02 §05 | MVR screening + DMV interplay; admit-no-fault language; insurance | Counsel light pass | Yes - counsel |

**Part 5 - Catalog row draft**
- card_line: "Who may drive for KitchFix, how to operate vehicles safely, and what to do after an accident."
- summary: "Governs anyone driving a KitchFix or business-use vehicle - delivery vans, box trucks, personal vehicles for KitchFix business. Driver eligibility (valid license, acceptable MVR, HR-authorized, no impairment), daily vehicle inspection, safe driving rules (seatbelts, no handheld phone, no unattended-running), the six-step accident response (stop & secure, call 911, call police, exchange & document, notify HR + VPO, file per SOP-002 §07.2), maintenance and records. Hot/cold food in transit follows SOP-008. Incident reporting itself lives in SOP-002."
- keywords: driver, fleet, vehicle, accident, MVR, motor vehicle record, delivery van, S1 incident, SOP-002, seatbelt, DUI
- shelf_proposed: Safety
- audience_proposed: operator (driver + EC) + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: NO ("Human Resources")
- approver_present: NO ("Pending - SLT")
- summary_keywords_present: no
- chunking_ready_real_headings: unknown; FLAT-RISK
- blocks_to_live: REF-008 -> POL-019 repoint (CRITICAL); owner role title; MVR threshold definition; approval; chunking-style sweep

**Part 7 - SME/actuals**
- SME: HR (Mariela); Insurance broker; Counsel (light)
- Actual needed from Kevin: MVR acceptable threshold; MVR recheck cadence; maintenance plan vendor/cadence; confirm REF-008 -> POL-019 repoint is the canonical move

**Part 8 - Verdict**
- NOT-READY
- Rationale: One CRITICAL retired-set pointer (REF-008 in §06 and Related Docs). Owner field violation. Approval pending. MVR thresholds undefined - operational vagueness. Must clear retired-set pointer + define driver eligibility floor before live.

---

### SOP-012 Pest Control & IPM

**File:** SOP-012_Pest_Control_IPM_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner Director of Culinary
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-012
- id_in_document: SOP-012
- title_matches_tracker: YES ("Pest Control & IPM")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: Owner = "Director of Culinary" (role title - PASS per STD-001 §10).

**Part 2 - Document-level**
- A1 Accuracy: PASS - IPM framing (exclusion + sanitation + monitoring) is standard; 6-inch off-floor consistent with SOP-008 §05; "Only the licensed PCO applies pesticides" is correct. No temperatures to validate here.
- A2 Actionability: PASS - five-step sighting response table is operator-actionable. Exclusion/Sanitation lists are concrete.
- A3 Completeness/Actuals: ISSUES - thin spot: "monthly at minimum, plus call-outs as needed" - good but vendor not named (could live in a per-site annex). "Work with your Client as this may be something they manage with their facilities team" - intentional ambiguity for clubhouse setups but flag the hedge.
- A4 Format/Metadata: ISSUES - no Contents/TOC block detected (SOP-class). No Version History. Sections numbered cleanly.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO. chunking_readiness: FLAT-RISK per manifest. number_hygiene: "6 inches off the floor" - tracks SOP-008. "monthly at minimum" - operational cadence; if Sous quotes "monthly" as canonical it would be defensible but could vary by site.

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-008 (§03 NOTE explicit "see SOP-008 §04", Related Docs) - In review
  - TPL-019 Master Cleaning Schedule (§04, Related Docs) - In review
  - CHK-003 (Related Docs) - In review
  - SOP-002 (Related Docs) - Live
  - STD-001 (Related Docs) - Live
- inbound_retired_pointer: NO
- contradiction_within_doc: none. 6-inch off-floor consistent with SOP-008 §05 ("food off the floor (six inches)"). Both docs name SOP-008 as the upstream.
- terminology_drift: none
- legal_flag: no

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MINOR | Metadata | No Contents/TOC; SOP-class should have TOC | Confirm in Word | No |
| MINOR | Metadata | No Version History block | Add | No |
| MINOR | §06 | "Work with your Client as this may be something they manage with their facilities team" - reads as a tactful hedge but the line is operationally vague. Site-leader-readable, but Sous could quote it as canonical guidance. Acceptable. | Note. | No |
| MINOR | §06 | "monthly at minimum, plus call-outs as needed" - cadence is named; consider whether a per-site annex should record the actual vendor + cadence | Per-site annex | No |

**Part 5 - Catalog row draft**
- card_line: "Prevention-first pest control - exclusion, sanitation, monitoring - and what to do when you see a pest."
- summary: "Defines KitchFix's Integrated Pest Management program at every account. IPM is prevention-first - exclusion (seal entry, closed doors, 6-inch-off-floor storage), sanitation (clean spills, lidded trash, no standing water, clean under equipment on TPL-019), and monitoring (glue boards, traps, bait stations, sighting logs). Licensed PCO contract required, monthly minimum service plus call-outs. No store-bought insecticides anywhere. Five-step sighting response (document, isolate/discard, clean/sanitize, notify EC + PCO, close the log entry). Maps tightly to SOP-008 §04 (receiving inspection) and §12 (facility/pest)."
- keywords: pest control, IPM, integrated pest management, PCO, sighting, exclusion, monitoring, traps, TPL-019, SOP-008
- shelf_proposed: Safety
- audience_proposed: operator (frontline EC + staff)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes
- approver_present: yes (SLT + Dir Culinary; pending approval but listed)
- summary_keywords_present: no
- chunking_ready_real_headings: unknown; FLAT-RISK
- blocks_to_live: chunking-style sweep; align with SOP-008 finalization

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary)
- Actual needed from Kevin: confirm PCO contract framework (corporate vendor vs Club-managed); whether per-site annex captures actual vendor names

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Operationally clean, tight to SOP-008. No retired-set pointers. Minor metadata cleanup. Can ride SOP-008 sequencing.

---

### SOP-014 Product Recall & Mock-Recall

**File:** SOP-014_Product_Recall_Mock_Recall_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner Director of Culinary
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-014
- id_in_document: SOP-014
- title_matches_tracker: YES ("Product Recall & Mock-Recall")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: Owner = "Director of Culinary" (role title - PASS).

**Part 2 - Document-level**
- A1 Accuracy: PASS - FDA/USDA recall monitoring named correctly. Two-hour traceability target is consistent with FDA mock-recall best practice. SOP-002 §07.4 named as the canonical foodborne-illness/incident process (correctly tracks the retired-SOP-016 absorption per user-memory context).
- A2 Actionability: PASS - 5-step "when a recall hits" table, clear segregate/quarantine/check-batched-items flow. Mock-recall test is concrete (random product, trace backward to supplier/lot, forward to all destinations, within 2 hours).
- A3 Completeness/Actuals: ISSUES - "Sign up for vendor and distributor recall alerts where available" - good but operationally thin (which vendors? which distributors? who at site holds the subscriptions?). Mock-recall cadence "at least once a year at every account" is specific.
- A4 Format/Metadata: ISSUES - no Contents/TOC. No Version History.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO. chunking_readiness: FLAT-RISK per manifest. number_hygiene: "within two hours" is the load-bearing number and FDA-aligned.

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-008 (Related Docs) - In review
  - SOP-002 (§05 explicit "SOP-002 (Safety & Incident Management) §07.4", Related Docs) - Live
  - TPL-018 Daily Food Safety Log (Related Docs) - In review (file not in Doc Set 1)
  - STD-001 (Related Docs) - Live
- inbound_retired_pointer: NO. CORRECTLY points at SOP-002 §07.4, not the retired SOP-016 (Foodborne-Illness Response). This is consistent with the SOP-016 absorption note in user memory.
- contradiction_within_doc: none
- terminology_drift: none
- legal_flag: no (operational process; recall obligations sit with vendor/regulator)

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MINOR | Metadata | No Contents/TOC; SOP-class should have TOC | Confirm in Word | No |
| MINOR | Metadata | No Version History | Add | No |
| MINOR | §02 | "Sign up for vendor and distributor recall alerts where available" - operationally thin; could name the vendor portals / who at site owns the subscriptions | Add a per-site annex line or name the key channels (Sysco, Reinhart, etc.) | Yes - Britt |
| MINOR | §05 | TPL-018 referenced - same TPL-018-not-on-disk question | Track with SOP-008 reconciliation | Yes - tracker |

**Part 5 - Catalog row draft**
- card_line: "Find, hold, and dispose of recalled product fast - and prove the system works with an annual mock-recall drill."
- summary: "Defines KitchFix's process for monitoring recalls (FDA/USDA notices, vendor alerts, Club/league alerts), removing recalled product from service (5-step pull: identify, locate, segregate + label HOLD-DO NOT USE, quarantine, check prepped/batched items), disposition (return to supplier or destroy on site, document quantity/lot/method), notification chain (EC -> RDO -> Director of Culinary; client per SLA if served; foodborne illness routes to SOP-002 §07.4), and a mandatory annual mock-recall drill that traces a random received product back to supplier+lot and forward to destinations within two hours. Documentation gates traceability."
- keywords: recall, product recall, mock recall, traceability, FDA, USDA, lot, supplier, SOP-002, foodborne illness
- shelf_proposed: Safety
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes
- approver_present: yes (pending)
- summary_keywords_present: no
- chunking_ready_real_headings: unknown; FLAT-RISK
- blocks_to_live: align with SOP-008 / TPL-018 / SOP-002 sequencing

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary)
- Actual needed from Kevin: which vendor recall portals are the canonical alert channels; who at corporate owns the upstream recall feed

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Clean and tight. CORRECTLY routes foodborne-illness response to SOP-002 §07.4 (NOT the retired SOP-016). Minor cleanup on metadata + vendor-alert specificity.

---

### SOP-015 Emergency Food Safety

**File:** SOP-015_Emergency_Food_Safety_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner Director of Culinary
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: SOP-015
- id_in_document: SOP-015
- title_matches_tracker: YES ("Emergency Food Safety")
- version_in_document: v1.0 Draft
- version_in_tracker: v1.0
- metadata_finding: Owner = "Director of Culinary" (role title - PASS).

**Part 2 - Document-level**
- A1 Accuracy: ISSUES - §03 power-loss table has a load-bearing typo / data error: "Frozen food still ≤ 41°F or holding ice crystals" - frozen should not be ≤ 41F, it should be ≤ 0F (or "still frozen"). This is a temperature error and is operationally misleading. Also "Cold TCS food between 41°F and 135°F / Safe up to 4 hours total in that zone, then discard" - this is TPHC framing but the threshold limits aren't quite right; the FDA Food Code allows cold-held food to rise to ≤ 70F for up to 4 hours if it started ≤ 41F (not "between 41F and 135F"). This appears to conflate TPHC with the temperature-abuse rule. The category should be "Cold TCS food above 41°F but at/below 70°F" with the 4-hour clock. The current wording "between 41°F and 135°F" implies food that's already above 70F (deep into danger zone) is safe for 4 hours, which contradicts SOP-008. CRITICAL.
- A2 Actionability: PASS - "when in doubt throw it out," clear stop-service triggers, water-loss / sewage / fire response. Six-section concise.
- A3 Completeness/Actuals: ISSUES - "Notify the Executive Chef and RDO immediately" - clear chain. "local health-department notification" before reopening - correct but operationally light on which events trigger this.
- A4 Format/Metadata: ISSUES - no Contents/TOC. No Version History. No "STD-001" in Related Docs (the only doc in batch C missing the STD-001 related-doc cross-link).
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: NO. chunking_readiness: FLAT-RISK. number_hygiene: the §03 table has a temperature error (see A1).

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-008 (Related Docs) - In review
  - SOP-016 Foodborne-Illness Response (Related Docs, listed as "Live") - **RETIRED** per manifest. CRITICAL.
  - TPL-018 (Related Docs) - In review
  - SOP-002 (Related Docs) - Live
- inbound_retired_pointer: **YES - CRITICAL.** Related Docs block lists SOP-016 "Foodborne-Illness Response" as Live. SOP-016 was retired and absorbed into SOP-002 §07.4 (per user memory and manifest). This is a textbook retired-set pointer treated as current.
- contradiction_within_doc: §03 table conflates TPHC with cold-held temperature-abuse rule (see A1) - this is an internal/cross-doc inconsistency against SOP-008 §07.
- terminology_drift: none
- legal_flag: no (no employment-law exposure; regulatory tie-in is local health code)

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | Related Docs | SOP-016 "Foodborne-Illness Response" listed as Live; SOP-016 is RETIRED and absorbed into SOP-002 §07.4 | Remove SOP-016 row; keep SOP-002 reference and add explicit §07.4 anchor | No - rule applies |
| CRITICAL | §03 Power Loss table | Row "Frozen food still ≤ 41°F" is a temperature data error - frozen is ≤ 0°F or "still frozen" | Reword: "Frozen food still showing ice crystals - safe; refreeze or use" | Yes - Britt |
| CRITICAL | §03 Power Loss table | Row "Cold TCS food between 41°F and 135°F / Safe up to 4 hours" conflates TPHC with temperature-abuse rule and contradicts SOP-008 §07. Per FDA Food Code, food that started ≤ 41°F may rise to ≤ 70°F for up to 4 hours; above 70°F (or once it reaches the wider danger zone) it must be discarded. The current wording suggests food at 130°F-ish is safe for 4 hours, which is wrong. | Rewrite the temperature thresholds to match FDA Food Code / SOP-008 §07; pull the table from SOP-008's TPHC logic | Yes - Britt + Kevin |
| MAJOR | Related Docs | STD-001 missing from Related Docs block (every other batch-C doc lists it) | Add STD-001 row | No |
| MINOR | Metadata | No Contents/TOC; SOP-class should have TOC | Confirm in Word | No |
| MINOR | Metadata | No Version History | Add | No |
| MINOR | §05 | "Sewage backup, flooding, fire" - which events require health-dept notification before reopening should be explicit | Add a tighter trigger list | Yes - Britt |

**Part 5 - Catalog row draft**
- card_line: "What to do when power, water, or refrigeration fails - protect the guest first, even if it means stopping service."
- summary: "Defines KitchFix's response to imminent food-safety hazards at every account: power loss / refrigeration failure (keep doors closed, monitor temps, table of action by food state), water loss or contamination (stop water-dependent operations, use bottled or hauled potable water under a boil advisory, no bare-hand or unsafe-water contact, resume only when confirmed potable), other imminent hazards (sewage backup, flooding, fire - cease operations, notify EC + RDO + health department, discard exposed food, do not reopen without approval), and return-to-operation verification (refrigeration back at temperature, water potable, clean/sanitize/restock, EC documents and signs off). When you cannot ensure safety, cease the affected operation."
- keywords: emergency, power loss, refrigeration failure, water contamination, boil water, sewage backup, imminent hazard, stop service, when in doubt throw it out
- shelf_proposed: Safety
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes
- approver_present: yes (pending)
- summary_keywords_present: no
- chunking_ready_real_headings: unknown; FLAT-RISK
- blocks_to_live: SOP-016 retired-pointer removal (CRITICAL); §03 temperature table rewrite (CRITICAL); STD-001 missing from Related Docs

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary)
- Actual needed from Kevin: confirm §03 temperature table rewrite matches SOP-008; confirm health-department notification trigger list

**Part 8 - Verdict**
- NOT-READY
- Rationale: Two CRITICAL findings - retired-set pointer to SOP-016 and a temperature data error in §03 that contradicts SOP-008. Must fix both before live.

---

### CHK-003 Health Inspection Readiness Checklist

**File:** CHK-003_Health_Inspection_Readiness_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner Sr Dir Ops (per manifest)
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: CHK-003
- id_in_document: CHK-003
- title_matches_tracker: YES ("Health Inspection Readiness")
- version_in_document: v1.0 Draft
- version_in_tracker: v1.0
- metadata_finding: Owner field stated as "Director of Culinary" in the doc metadata - but manifest says Sr Dir Ops. POSSIBLE OWNERSHIP DRIFT. MAJOR. Confirm with Kevin which is canonical (CHK-003 is a culinary-floor walkthrough so Dir Culinary is operationally defensible; Sr Dir Ops may have been an older tracker entry).

**Part 2 - Document-level**
- A1 Accuracy: PASS - 135F hot / 41F cold consistent throughout. Cooling 135->70 in 2h / 70->41 in 4h. Reheat 165F in 2h. 6-inch off floor. 7-day date marking. All consistent with SOP-008.
- A2 Actionability: PASS - this is exactly what a CHK doc should be: a fillable walkthrough with check boxes and a corrective-action column. The 10-section structure (Approved Sources -> Storage -> Cooking/Cooling -> Holding -> Thermometers -> Cross-Contam/Allergens -> Cleaning -> Hygiene -> Facility -> Documentation) maps section-for-section to SOP-008 §04-§13.
- A3 Completeness/Actuals: PASS - Readiness Summary section at end with "Count / Notes" rows; Sign-Off block with PIC and EC.
- A4 Format/Metadata: ISSUES - Owner field potential drift (see Part 1). No Contents/TOC (a CHK may not require one but STD-001 should govern). Has a "HOW TO USE" intro section.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: **YES (high) - per Audit Brief §4 and user memory, TPL/CHK-class fillable docs carry the risk that example checklist items get retrieved by Sous as canonical rules.** This CHK is well-aligned to SOP-008 so the checklist items happen to be canonical - but if SOP-008 drifts and CHK-003 doesn't, Sous could quote a stale check item as authoritative. Need a doctrinal note that CHK-003 derives from SOP-008 and SOP-008 is the source of truth. chunking_readiness: extract shows a tabular pattern that may chunk awkwardly. number_hygiene: all numbers track SOP-008.

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-008 (Related Docs) - In review
  - TPL-018 Daily Food Safety Log ("Documentation & Logs" section + Related Docs) - In review (not in Doc Set 1)
  - TPL-019 Master Cleaning Schedule ("Cleaning, Sanitizing & Warewashing" section + Related Docs) - In review
  - FORM-008 Health Reporting Agreement ("Personal Hygiene" section + Related Docs) - In review
  - STD-001 (Related Docs) - Live
- inbound_retired_pointer: NO. CRITICALLY, the "Documentation & Logs" section asks about "ServSafe / food-handler certifications current for the team" but does NOT point at the retired REF-009 (ServSafe Cert Tracker). This is correct - cert tracking lives in Rippling per user-memory context.
- contradiction_within_doc: none
- terminology_drift: none
- legal_flag: no

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | Owner field shows "Director of Culinary" in doc but manifest says Sr Dir Ops. Pick one. | Confirm canonical owner; update tracker or doc | Yes - Kevin |
| MAJOR | Whole doc | Template-as-canonical risk: a checklist used as Sous training source can become the authoritative source if SOP-008 drifts. Best practice is to add a one-line preamble: "This checklist derives from SOP-008 §02-§13; if a check item differs from SOP-008, SOP-008 governs." | Add the preamble line | No |
| MINOR | Documentation & Logs | TPL-018 referenced; same TPL-018-not-on-disk tracker question | Reconcile | Yes - tracker |
| MINOR | Cross-Contamination & Allergens | "Allergen storage protocol followed (allergen-containing below allergen-free)" - check this matches PB-002 canonical storage order; SOP-008 §05 storage order doesn't address allergens specifically. PB-002 governs allergen storage. | Confirm against PB-002 | Yes - Britt |
| MINOR | Holding | "Hot-held food ≥ 135°F; cold-held food ≤ 41°F" - canonical. No issue. | None | No |

**Part 5 - Catalog row draft**
- card_line: "The fillable walkthrough every EC runs before a health inspection - and as a monthly self-audit - so the kitchen is inspection-ready every day."
- summary: "A fillable checklist that maps section-for-section to SOP-008 (Food Safety Management). Walk every line: approved sources & receiving, storage/date marking/thawing, cooking/cooling/reheating, holding & TPHC, thermometers & calibration, cross-contam & allergens, cleaning/sanitizing/warewashing, personal hygiene & employee health, facility/water/pest, documentation & logs. Each check is Pass / Needs work / N/A with a corrective-action column. Readiness Summary block tallies needs-work items, prioritizes temp/hygiene/sanitation, and sets a target close date. PIC + EC sign off. Run before announced inspections and monthly as a self-audit. If an inspector arrives, notify the EC immediately, accompany, take notes, correct what you can, document every finding."
- keywords: health inspection, readiness, self-audit, walkthrough, checklist, SOP-008, ServSafe, corrective action, PIC, EC
- shelf_proposed: Safety
- audience_proposed: operator (frontline EC + PIC)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes (but ownership drift question - see Part 1)
- approver_present: NO ("Pending - SLT + Dir Culinary")
- summary_keywords_present: no
- chunking_ready_real_headings: unknown; FLAT-RISK
- blocks_to_live: owner reconciliation; SOP-008 derivation preamble; approval

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary)
- Actual needed from Kevin: confirm canonical owner (Dir Culinary vs Sr Dir Ops); confirm doctrine that SOP-008 is the source-of-truth and CHK-003 derives from it

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Operationally clean and aligned with SOP-008. Template-as-canonical risk is manageable with a one-line preamble. Owner reconciliation needed. Approval pending.

---

### TPL-019 Master Cleaning Schedule

**File:** TPL-019_Master_Cleaning_Schedule_v1_0.docx
**Tracker status / version:** In review (v1.0) - Owner Director of Culinary
**Structure verdict (chunking probe):** FLAT-RISK (per manifest)

**Part 1 - Identification**
- id_from_filename: TPL-019
- id_in_document: TPL-019
- title_matches_tracker: YES ("Master Cleaning Schedule")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: Owner = "Director of Culinary" (role title - PASS).

**Part 2 - Document-level**
- A1 Accuracy: PASS - cleaning frequencies are operator-defensible minimums. "Maps to SOP-008 §10" is the correct anchor. The reframing per Kevin (per user memory) - "minimum cleaning floor, not exhaustive" - is explicitly stated in the ANCHOR ("This is the floor, not the ceiling") and the "What This Is" intro.
- A2 Actionability: PASS - schedule is grouped Daily / Weekly / Monthly / Periodic-Quarterly with task, responsible role, and a Done (initial/date) column. Example row "Floors / Sweep and mop... Closing cook / J.S. / 6-12" shows the fill pattern.
- A3 Completeness/Actuals: PASS - per Kevin's reframe this is the minimum floor, intentionally not exhaustive.
- A4 Format/Metadata: ISSUES - no Contents/TOC (TPL-class may not require). No Version History block. Has "What This Is" intro and "The Schedule" main block.
- A5 SousAI-readiness: ISSUES - template_as_canonical_risk: **HIGH and DOCUMENTED.** Per Audit Brief §4 and user memory, TPL-class docs carry the risk that Sous retrieves example content as canonical. **Here specifically: the example row "Floors (example) / Sweep and mop all kitchen floors / Closing cook / J.S. / 6-12" - if Sous chunks this without the "(example)" marker, it could quote "J.S. / 6-12" as canonical operational data.** Also, the "Pest-control deep service / Licensed PCO service / Exec Chef schedules" row could be quoted as a corporate-wide mandate when it's actually a site-by-site cadence per SOP-012 §06. chunking_readiness: tabular structure may chunk awkwardly. number_hygiene: "6 inches off the floor" is not in this doc (lives in SOP-008/SOP-012); no specific temp/dollar/date risk here except the example "J.S. / 6-12" date stub.

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-008 (Maps to SOP-008 §10, Related Docs) - In review
  - SOP-012 (Related Docs) - In review
  - TPL-018 (Related Docs) - In review (not in Doc Set 1)
  - CHK-003 (in "What This Is" intro: "a current, initialed schedule is checked on CHK-003") - In review
  - STD-001 (Related Docs) - Live
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: none
- legal_flag: no

**Part 4 - Findings**

| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | "The Minimum Schedule" example row | Template-as-canonical risk: example "Floors (example) / Sweep and mop all kitchen floors / Closing cook / J.S. / 6-12" has placeholder initials "J.S." and date "6-12" that Sous could quote as canonical fact. STD-001 callout convention says specimen content must be marked. | Either remove the initials/date from the example or make the (example) marker more aggressive (e.g., "EXAMPLE ROW - DO NOT QUOTE") | No - design choice |
| MAJOR | Whole doc | Per Kevin's reframe - this is minimum floor, not exhaustive. Add a one-line Sous-facing preamble: "TPL-019 is the company minimum cleaning floor. Site working schedules add to it but never subtract. SOP-008 §10 governs methods." This is also documented in the existing ANCHOR but make it Sous-bait. | Add explicit Sous-facing preamble at top | No |
| MINOR | Metadata | No Version History; TPL-class may not require but STD-001 should govern | Add | No |
| MINOR | "What This Is" | CHK-003 referenced in intro but not in Related Docs block; add CHK-003 to Related Docs for completeness | Add CHK-003 to Related Docs | No |
| MINOR | "Periodic / Quarterly" / Pest-control deep service | Cadence per SOP-012 says "monthly at minimum" - here Periodic/Quarterly may be the deep service tier; clarify or align the language | Clarify | Yes - Britt |

**Part 5 - Catalog row draft**
- card_line: "The company-minimum cleaning schedule every KitchFix kitchen meets - what gets cleaned, how often, who owns it. The floor, not the ceiling."
- summary: "Sets the minimum cleaning expectations for every KitchFix account - what gets cleaned, how often, and who owns it. Grouped Daily / Weekly / Monthly / Periodic-Quarterly with task, responsible role, and a Done (initial/date) column. Every task is assigned to a role; whoever completes it initials and dates. EC verifies completion weekly; missed tasks are corrected, not carried forward. Each site builds its own working schedule from this floor - adding equipment and stations, never removing rows. Cleaning methods (sanitizer concentrations, warewashing, chemicals) live in SOP-008 §10. Use the two together. A current, initialed schedule is checked on CHK-003."
- keywords: cleaning, schedule, master cleaning schedule, daily, weekly, monthly, sanitize, deep clean, walk-in, dish machine, SOP-008
- shelf_proposed: Safety (or Operations - this is operationally tactical; Safety reads better given SOP-008 lineage)
- audience_proposed: operator (frontline EC + cook + dishwasher)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes
- approver_present: yes (pending)
- summary_keywords_present: no
- chunking_ready_real_headings: unknown; FLAT-RISK
- blocks_to_live: example-row placeholder treatment (Sous risk); Sous-facing minimum-floor preamble; add CHK-003 to Related Docs

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary)
- Actual needed from Kevin: confirm example-row treatment policy (placeholder vs explicit DO-NOT-QUOTE); align deep-clean cadence language with SOP-012

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: Floor-not-ceiling reframe is in the doc. Template-as-canonical risk is the main Sous-readiness concern and is solvable with explicit marker treatment.

---

## Cross-batch observations

### Retired-set pointers found in this batch
- **SOP-010 §06 + Related Docs**: REF-008 (Permit & License Tracker) listed as Live. **CRITICAL** - REF-008 is retired and superseded by POL-019.
- **SOP-015 Related Docs**: SOP-016 (Foodborne-Illness Response) listed as Live. **CRITICAL** - SOP-016 is retired and absorbed into SOP-002 §07.4.
- **SOP-005 §03 NOTE**: References POL-012 ("on hold") for E-Verify parking lot. Borderline - the pointer is honestly labeled as on-hold, not as if current. Flagged MAJOR for Kevin to decide whether on-hold pointers are acceptable in print.
- No batch-C doc points at retired REF-009 (ServSafe Cert Tracker) - confirmed. CHK-003 "ServSafe / food-handler certifications current for the team" correctly does NOT point at REF-009.
- No batch-C doc points at retired SOP-011 (OSHA 300 Recordkeeping). SOP-010 (fleet/driver) correctly routes accident reporting to SOP-002 §07.2 - good.

### Contradictions between SOP-008 (anchor) and satellite docs
- **SOP-015 §03 power-loss table conflates TPHC with the cold-held temperature-abuse rule** and uses an out-of-spec "frozen ≤ 41°F" line. SOP-008 §07 is the canonical source. CRITICAL.
- SOP-012, SOP-014, CHK-003, TPL-019 are all aligned to SOP-008's numbers and language. No drift.
- TPL-019 maps cleanly to SOP-008 §10; CHK-003 maps section-for-section to SOP-008 §04-§13. Strong consistency.

### TPL-018 is referenced everywhere but missing from Doc Set 1
- SOP-008 (§04, §06, §07, §10, §13), SOP-014 (Related Docs), SOP-015 (Related Docs), CHK-003 (Documentation & Logs section + Related Docs), TPL-019 (Related Docs) all reference TPL-018 Daily Food Safety Log as Live or In Review. Per manifest TPL-018 was built and reviewed but is not in Doc Set 1 today (manifest reconciliation item #7). The whole batch-C cluster depends on TPL-018 being findable. Surface to main session.

### Owner-field role-title compliance (STD-001 §10) - batch-C scorecard
- SOP-004: "Human Resources" - FAIL (department, not role title) - MAJOR
- SOP-005: BLANK - FAIL - MAJOR
- SOP-008: "Director of Culinary" - PASS
- SOP-010: "Human Resources" - FAIL - MAJOR
- SOP-012: "Director of Culinary" - PASS
- SOP-014: "Director of Culinary" - PASS
- SOP-015: "Director of Culinary" - PASS
- CHK-003: "Director of Culinary" in doc / manifest says Sr Dir Ops - DRIFT - MAJOR
- TPL-019: "Director of Culinary" - PASS

The HR-owned docs are the consistent offenders for the department-as-owner pattern. Aligns with user memory: "11 OPD docs use department 'Human Resources' instead of a role title per STD-001; deferred to its own per-doc batch."

### Terminology drift patterns
- "People Operations" vs "Human Resources" - inconsistent within SOP-004 (metadata = HR, body uses People Operations); SOP-005 / SOP-010 use HR canonically. Library-wide cleanup needed (already flagged in user memory).
- "Executive Chef" vs "EC" - both used; this is house style.
- "Person in Charge / PIC" - canonical and consistent across SOP-008, SOP-012, SOP-015, CHK-003.

### Template-as-canonical risk
- TPL-019 has the cleanest example of this: an example row with placeholder initials "J.S." and date "6-12" that could be Sous-quoted as canonical. Per Audit Brief §4, this is a known TPL-class risk.
- CHK-003 has lower risk because every check item happens to be canonical (derived from SOP-008) - but the risk surfaces if SOP-008 drifts and CHK-003 doesn't.

### Chunking-readiness
- All 9 docs flagged FLAT-RISK in manifest. None show `[H1]` / `[H2]` / `[H3]` extraction markers. Section headers are plain text ("SECTION 01"). For Sous to chunk by section, every doc needs a heading-styles sweep in Word.
- SOP-008 is the most critical for chunking-style work given its 14-section scope and downstream load-bearing role.

### Net batch-C health
- **CRITICAL findings: 4** (REF-008 in SOP-010; SOP-016 in SOP-015; two temperature errors in SOP-015 §03)
- **MAJOR findings: 11** (mostly owner-field, plus a few cross-ref repoints and the SOP-015 STD-001 missing from Related Docs)
- **MINOR findings: ~20** (TOC/Version History blocks, alert-channel specificity, etc.)
- **NOT-READY verdicts: 3** (SOP-005, SOP-010, SOP-015)
- **READY-PENDING-SME verdicts: 6** (SOP-004, SOP-008, SOP-012, SOP-014, CHK-003, TPL-019)
- The food-safety cluster (SOP-008, SOP-012, SOP-014, CHK-003, TPL-019) is in better shape than the HR/driver cluster (SOP-004, SOP-005, SOP-010). SOP-015 is the outlier that needs a Britt pass on the temperature table.
