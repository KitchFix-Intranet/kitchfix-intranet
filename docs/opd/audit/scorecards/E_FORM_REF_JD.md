# Batch E Scorecards - FORM-003 through FORM-009 + REF-006/007 + 4x JD TEMPLATE

**Scored:** 2026-06-14
**Batch:** E (11 docs)
**Per:** RUBRIC_PACK.md Scorecard v2 condensed
**Read-only Pass 1.** Findings cite section. Hyphens only.

---

### FORM-003 Coaching & Verbal Warning Record

**File:** FORM-003_Coaching_Verbal_Warning_Record_v1.0.txt
**Tracker status / version:** In review (v1.0), Owner = HR
**Structure verdict (chunking probe):** THIN (acceptable for FORM class - single-page record)

**Part 1 - Identification**
- id_from_filename: FORM-003
- id_in_document: FORM-003 (line 3)
- title_matches_tracker: yes ("Coaching & Verbal Warning Record")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - no regulated facts; reflects SOP-004 Level 1 mechanics (manager record only, employee does not sign, file in site folder, submit to People Operations within 24 hours).
- A2 Actionability: PASS - clear fields, named recipients (RDO, People Operations), explicit "within 24 hours" timing. A new manager could complete this tomorrow.
- A3 Completeness/Actuals: PASS - field labels are operator-facing; no thin spots ("file in site employee folder" is the right altitude for a form).
- A4 Format/Metadata: ISSUES - thin metadata block. Document ID + version + "KitchFix Internal" classification are present in subheader (line 3) but there is no full STD-001 metadata block (no APPROVED BY / NEXT REVIEW / OWNER block of the kind FORM-007/008/009 carry). Single-page FORM is acceptable per STD-001 §11 but the metadata anchor is still expected.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - the form is clearly a fill-in instrument and labels with NOTE callouts. Sample data minimal (no example employee name).
  - chunking_readiness: THIN - no `[H1]`/`[H2]`/`[H3]` markers in extraction. Will chunk as one blob. Acceptable for a one-page form.
  - number_hygiene: clean - no figure / date / dollar placeholders.

**Part 3 - Library checks**
- cross_refs_in_text: none explicit in body. (Implicit parent = SOP-004 per References Map, but doc body does not name SOP-004.)
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "People Operations" used (line 5, 49). Convention list flags "People Operations" vs "Human Resources" as drift to surface - flagging consistent with batch pattern. Note: HR is the tracker-named owner; in-doc usage prefers People Operations.
- legal_flag: no

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Header / metadata | No full STD-001 metadata block (no APPROVED BY / NEXT REVIEW / OWNER / CLASSIFICATION fields formatted as in FORM-007/008/009). | Add the STD-001 §11 FORM-class metadata block. | no |
| MAJOR | Related Documents | No Related Documents block linking back to SOP-004 §02 Level 1 (per References Map). | Add a Related Documents block citing SOP-004 (Parent SOP, governs this form). | no |
| MINOR | §01 line 19 | "RDO NOTIFIED (NAME & DATE)" but no explicit named-recipient routing inside SOP-004 cited. | Reference SOP-004 §02 Level 1 in the NOTE at the top. | no |
| MINOR | Throughout | Mixed case in field labels - all-caps headings ("EMPLOYEE NAME") interleaved with sentence case ("Manager Signature"). | Pick one case convention per STD-001. | no |

**Part 5 - Catalog row draft**
- card_line: "Document a coaching conversation or verbal warning. Manager record - employee does not sign. File and submit to People Ops within 24 hours."
- summary: "FORM-003 is the manager's record of a Level 1 coaching conversation or verbal warning under SOP-004. It captures employee/site, the specific behavior or standard at issue, prior history, the agreed next steps, and the manager's signature. The employee does not sign. The signed form files in the site employee folder and submits to People Operations within 24 hours."
- keywords: ["coaching", "verbal warning", "discipline", "Level 1", "SOP-004", "manager record", "People Operations", "site employee folder", "FORM-003"]
- shelf_proposed: HR & People
- audience_proposed: operator (manager-facing)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no (write it)
- owner_present_role_title: no (no metadata block)
- approver_present: no
- summary_keywords_present: no
- chunking_ready_real_headings: no (single-page form acceptable)
- Blocks to Live: STD-001 metadata block; Related Documents block citing SOP-004.

**Part 7 - SME/actuals**
- SME: HR (Mariela) - confirm 24-hour submission and that employee never signs
- Actual needed from Kevin: confirm whether "RDO Notified" is required to be a same-day notification (yes/no, gate)

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: form mechanics are operator-ready; metadata block + Related Documents block are the two STD-001 gaps to close before live.

---

### FORM-004 Written Warning

**File:** FORM-004_Written_Warning_v1.0.txt
**Tracker status / version:** In review (v1.0), Owner = HR
**Structure verdict (chunking probe):** THIN (acceptable for FORM class)

**Part 1 - Identification**
- id_from_filename: FORM-004
- id_in_document: FORM-004 (line 3)
- title_matches_tracker: yes ("Written Warning")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - Level 2/3/3-suspension structure aligns with SOP-004 ladder. At-will language not asserted here but acceptable for a Level 2 instrument.
- A2 Actionability: PASS - explicit categories with named policy links (POL-002 for dress code), explicit "specify" prompts, employee response field, witness initial path if employee refuses.
- A3 Completeness/Actuals: PASS - well-scoped fields including Prior Disciplinary History (3 rows), Corrective Expectation, CRITICAL escalation callout. Operator-actionable.
- A4 Format/Metadata: ISSUES - same as FORM-003. No full STD-001 metadata block; no Related Documents block citing SOP-004 §02 Level 2 & 3 (per References Map).
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: THIN. Single-blob risk; acceptable for form class.
  - number_hygiene: clean.

**Part 3 - Library checks**
- cross_refs_in_text: POL-002 (§03 Violation Category, line 37: "Dress code / appearance (POL-002)") - cited correctly per References Map (POL-002 §06 routes violations to SOP-004, and SOP-004 in turn governs this form).
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: none
- legal_flag: no - although LEGAL-REVIEW is generally advised for the SOP-004 family, this form itself contains no legal assertions.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Header / metadata | No full STD-001 metadata block (no APPROVED BY / NEXT REVIEW / OWNER / CLASSIFICATION fields). | Add STD-001 §11 FORM-class metadata block. | no |
| MAJOR | Related Documents | No Related Documents block linking to SOP-004 §02 Level 2 & 3, POL-002, POL-004, AGR-001. | Add Related Documents block per References Map line 51. | no |
| MINOR | §05 Prior Disciplinary History | Three rows hard-coded; in practice employees can have more or fewer. | Allow expandable rows or note "add additional rows as needed." | no |
| MINOR | Throughout | Mixed case (all-caps for some, sentence case for others). | Normalize per STD-001. | no |

**Part 5 - Catalog row draft**
- card_line: "Written Warning - Level 2, Level 3 (Final), or Level 3 Suspension. Employee signs receipt only. Captures violation, history, and corrective expectation. SOP-004 instrument."
- summary: "FORM-004 is the Level 2/3 instrument under SOP-004 Formal Disciplinary Process. It captures the warning level (Written, Final Written, or Suspension without pay), the violation category, a description of incident with date/time/location, prior disciplinary history (three rows), the specific corrective expectation, the employee's optional response, and signatures. Employee signature is acknowledgment of receipt, not agreement. If the employee refuses to sign, the refusal is documented and witnessed."
- keywords: ["written warning", "Level 2", "Level 3", "Final Warning", "Suspension", "SOP-004", "progressive discipline", "FORM-004", "manager signature", "employee response"]
- shelf_proposed: HR & People
- audience_proposed: operator (manager-facing)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- Blocks to Live: STD-001 metadata block; Related Documents block.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Counsel (SOP-004 family)
- Actual needed from Kevin: confirm RDO notification gate and timing for Level 2/3.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: form content is operator-ready; metadata + related-docs are the print-format blocks.

---

### FORM-005 Performance Improvement Plan

**File:** FORM-005_Performance_Improvement_Plan_v1.0.txt
**Tracker status / version:** In review (v1.0), Owner = HR
**Structure verdict (chunking probe):** THIN (acceptable for FORM class)

**Part 1 - Identification**
- id_from_filename: FORM-005
- id_in_document: FORM-005 (line 3)
- title_matches_tracker: yes ("Performance Improvement Plan")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - at-will preservation language (§06) appropriate for PIP doc. 30-day standard / 60-day extended with RDO + People Operations approval is operationally clear.
- A2 Actionability: PASS - structured goal/activity/check-in fields. RDO signature is required (line 81), matching SOP-004 §03 escalation authority.
- A3 Completeness/Actuals: PASS - covers goals, activity plan, success criteria, consequences, confidentiality, signatures.
- A4 Format/Metadata: ISSUES - same family pattern: no full STD-001 metadata block; no Related Documents block citing SOP-004 §03.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: THIN.
  - number_hygiene: clean - "30 days (standard)" and "60 days (extended)" are operational rules, not placeholders.

**Part 3 - Library checks**
- cross_refs_in_text: none explicit in body. Implicit parent = SOP-004 §03 per References Map.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "People Operations" used (line 23). Same batch pattern.
- legal_flag: LEGAL-REVIEW - PIP doc with at-will language. Counsel should validate the "may be terminated prior to PIP end date if improvement is clearly not forthcoming" sentence (line 65) for state-specific exposure. Not a ruling, just a flag.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Header / metadata | No full STD-001 metadata block. | Add STD-001 §11 FORM-class metadata block. | no |
| MAJOR | Related Documents | No Related Documents block citing SOP-004 §03, POL-001. | Add Related Documents block per References Map line 52. | no |
| MAJOR | §06 Consequences | At-will + early-termination language. Counsel review required for state-specific PIP termination exposure. | LEGAL-REVIEW flag. | no |
| MINOR | §03 Improvement Goals | Three numbered rows hard-coded ("1-3 specific, measurable goals"); some PIPs may need only one. | Note "1-3 goals" as the structural rule; allow blank rows. | no |

**Part 5 - Catalog row draft**
- card_line: "Performance Improvement Plan - 30-day standard, 60-day extended needs RDO + People Ops approval. 1-3 measurable goals. RDO signature required."
- summary: "FORM-005 is the SOP-004 §03 PIP instrument. The employee and manager agree on 1-3 measurable improvement goals over a 30-day standard (or 60-day extended) PIP period. Activity plans, success criteria, and check-ins are documented. At-will employment is preserved. RDO signature is mandatory. Failure to meet goals or any further violation during the PIP period escalates to further discipline up to and including termination."
- keywords: ["PIP", "performance improvement plan", "Level 3", "SOP-004", "30-day", "60-day", "RDO approval", "measurable goals", "improvement plan", "FORM-005"]
- shelf_proposed: HR & People
- audience_proposed: operator (manager-facing)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- Blocks to Live: STD-001 metadata block; Related Documents block; counsel legal review on §06.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Counsel
- Actual needed from Kevin: validate the 30/60-day standard with HR; confirm at-will language matches counsel template.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: form mechanics are operator-ready; counsel review on §06 plus the standard STD-001 print-format gaps.

---

### FORM-006 Separation Record

**File:** FORM-006_Separation_Record_v1.0.txt
**Tracker status / version:** In review (v1.0), Owner = HR
**Structure verdict (chunking probe):** THIN (acceptable for FORM class)

**Part 1 - Identification**
- id_from_filename: FORM-006
- id_in_document: FORM-006 (line 3)
- title_matches_tracker: yes ("Separation Record")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - separation types reflect SOP-004 §04 Level 4 progression (progressive, immediate zero-tolerance, post-PIP, voluntary, end-of-season, mutual). Final-pay caveat ("Do not make verbal commitments to the employee about final pay timing," line 95) correctly defers to state law and People Operations.
- A2 Actionability: PASS - prescribes same-day actions: copy to People Ops, employee receives copy, equipment recovery, access revocation checklist (intranet/People Portal, email, Rippling, Google Workspace, site-specific access).
- A3 Completeness/Actuals: PASS - this is the strongest of the SOP-004 family forms in detail. Notes prior FORM-003/004/005 references (line 49) explicitly. AGR-002 referenced for laptop (line 55).
- A4 Format/Metadata: ISSUES - same family pattern: no full STD-001 metadata block; no Related Documents block.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: THIN.
  - number_hygiene: clean.

**Part 3 - Library checks**
- cross_refs_in_text: AGR-002 (§04 Equipment & Access Return, line 55: "KitchFix-issued laptop (AGR-002 on file)"); FORM-003/004/005 (§03 Reason for Separation, line 49: "Prior disciplinary documents on file (FORM-003/004/005 reference numbers and dates, if applicable)"). Implicit parent = SOP-004 §02 Level 4 per References Map.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "People Operations" used (line 5, 23, 27, 85, 95). Same batch pattern.
- legal_flag: LEGAL-REVIEW - §06 Final Pay & Benefits defers to state law correctly. Counsel should confirm the access-revocation checklist (§05) is timed acceptably across all 8 states. Flagging not ruling.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Header / metadata | No full STD-001 metadata block. | Add STD-001 §11 FORM-class metadata block. | no |
| MAJOR | Related Documents | No Related Documents block citing SOP-004 §04 Level 4, AGR-002, POL-015 (PTO accrual). | Add Related Documents block. | no |
| MINOR | §02 Separation Type | "Termination - progressive discipline (following Levels 1-3)" - "Levels 1-3" wording is unambiguous but could explicitly cite SOP-004. | Add SOP-004 §02/§03 citations to each progressive-discipline checkbox. | no |
| MINOR | §05 Access Revocation | "Same day" rule is correct but could conflict with after-hours separations. | Add "or by close of next business day" language for after-hours cases. | no |

**Part 5 - Catalog row draft**
- card_line: "Separation Record - capture separation type, prior discipline, equipment return, access revocation. Employee receives copy. Submit to People Ops same day."
- summary: "FORM-006 is the SOP-004 §04 Level 4 separation instrument. It captures separation type (voluntary, end-of-season, progressive-discipline termination, immediate zero-tolerance, post-PIP, mutual), the reason with reference to prior FORM-003/004/005 records, equipment and access return (laptop per AGR-002, keys, uniforms), access revocation (intranet, email, Rippling, Google Workspace, site), final pay placeholders (state law governs - do not commit timing verbally to employee), separation conversation notes, and signatures. Employee receives a copy."
- keywords: ["separation", "termination", "Level 4", "SOP-004", "final pay", "access revocation", "Rippling", "AGR-002", "laptop return", "FORM-006"]
- shelf_proposed: HR & People
- audience_proposed: operator (manager-facing)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- Blocks to Live: STD-001 metadata block; Related Documents block; counsel review on access-revocation timing.

**Part 7 - SME/actuals**
- SME: HR (Mariela) + Sebastian (Accounting, final-pay routing) + Counsel
- Actual needed from Kevin: confirm same-day access revocation across all 8 states is operationally feasible; confirm Rippling deactivation step belongs to People Ops or to IT.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: this is the most operationally complete of the SOP-004 family forms. Print-format gaps + counsel review on access-revocation timing.

---

### FORM-007 Pay Increase Recommendation

**File:** FORM-007_Pay_Increase_Recommendation_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner = People Operations
**Structure verdict (chunking probe):** GOOD (sectioned with header band, has metadata block)

**Part 1 - Identification**
- id_from_filename: FORM-007
- id_in_document: FORM-007 (line 12)
- title_matches_tracker: yes ("Pay Increase Recommendation")
- version_in_document: v1.0 · Draft
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - workflow (EC/RDO -> RDO/VP Ops -> People Ops + Accounting -> Rippling) aligns with POL-007 authority matrix per References Map line 74. SOP-004 eligibility gate correctly applied (Level 3 / final warning / PIP pauses increase, line 53, 95).
- A2 Actionability: PASS - explicit routing order, named fields (Effective Date, Current Band Position, Within Band Y/N, Disciplinary Status), exception sign-off rule (VP Ops + People Operations for out-of-band).
- A3 Completeness/Actuals: PASS - aligned to REF-006/REF-007 bands. Workflow includes both People Ops (band/equity/compliance) and Accounting (budget fit) validations.
- A4 Format/Metadata: PASS - has the full STD-001 metadata block (DOCUMENT ID / TITLE / VERSION / APPROVED BY / NEXT REVIEW / OWNER / CLASSIFICATION) and Related Documents table. Sets the print-format pattern that FORM-003/004/005/006 should adopt.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - clearly a workflow form.
  - chunking_readiness: GOOD - has section headers ("HOW TO USE", "THE REQUEST", "APPROVALS & VALIDATION", "HANDLING & REFERENCES"). Better than the SOP-004 family forms.
  - number_hygiene: clean - no figures embedded; pay numbers live in REF-006/REF-007.

**Part 3 - Library checks**
- cross_refs_in_text: POL-007 (multiple); REF-006 (lines 41, 152); REF-007 (lines 41, 159); SOP-004 (lines 53, 95, 165); SOP-007 (line 91); SOP-001 (line 91); STD-001 (line 171). All match References Map line 74.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: "People Operations" used throughout. Consistent with class.
- legal_flag: no - though pay records are confidential, the doc itself acknowledges this (CRITICAL note line 137).

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MINOR | THE REQUEST | "% Increase" field exists but no rule for the typical merit range (e.g., 3-5% standard, >7% needs justification). | Optionally add a guideline or leave to POL-007 authority matrix. | yes - confirm POL-007 sets the range floor |
| MINOR | APPROVALS & VALIDATION | Recommended By labels split between EC (hourly) and RDO (leadership). Approved By split between RDO and VP Ops. This works but could explicitly cite POL-007 §X authority matrix. | Add cross-ref to POL-007 specific section. | no |
| MINOR | Related Documents | SOP-001 and SOP-007 are referenced in body (line 91 "Performance Review on File") but not in the Related Documents table. | Add SOP-001 and SOP-007 to Related Documents. | no |

**Part 5 - Catalog row draft**
- card_line: "Pay Increase Recommendation - EC/RDO recommends, RDO/VP Ops approves, People Ops + Accounting validate, then into Rippling. Bands per REF-006/REF-007."
- summary: "FORM-007 is the workflow form for POL-007 Compensation. The Executive Chef (hourly) or RDO (leadership) recommends an increase, capturing employee, role, account/state, increase type (merit, market/structural, promotion, equity, retention), current and proposed rate, band position, percentage increase, effective date, current performance review (SOP-001 or SOP-007), disciplinary status (SOP-004 gate), ServSafe/Allergen certification status, and within-band Y/N. The RDO or VP Ops approves per POL-007 authority matrix. People Operations validates band/equity/compliance; Accounting validates budget fit. The increase enters Rippling once both validations clear. Restricted - confidential pay information."
- keywords: ["pay increase", "compensation", "POL-007", "REF-006", "REF-007", "merit", "promotion", "Rippling", "FORM-007", "People Operations", "Accounting", "EC", "RDO", "VP Ops"]
- shelf_proposed: HR & People
- audience_proposed: corporate / leadership (restricted)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no (write it)
- owner_present_role_title: yes (People Operations)
- approver_present: pending - SLT (line 23)
- summary_keywords_present: no
- chunking_ready_real_headings: GOOD
- Blocks to Live: SLT approval; add SOP-001 / SOP-007 to Related Documents.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops) + Sebastian (Accounting)
- Actual needed from Kevin: confirm "% Increase" guideline (does POL-007 set a default cap, or is it fully RDO/VP Ops judgment?); confirm Rippling owner for entry step.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: this is a well-formed FORM-class doc. SLT approval pending. Minor SOP-001/SOP-007 reference addition.

---

### FORM-008 Health Reporting Agreement

**File:** FORM-008_Health_Reporting_Agreement_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner = Director of Culinary
**Structure verdict (chunking probe):** GOOD (metadata block + section headers present)

**Part 1 - Identification**
- id_from_filename: FORM-008
- id_in_document: FORM-008 (line 12)
- title_matches_tracker: yes ("Health Reporting Agreement")
- version_in_document: v1.0 · Draft
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - The "Big 6" reportable diagnoses (Norovirus, Hepatitis A, Shigella, STEC, Salmonella Typhi, Nontyphoidal Salmonella) and the symptoms list (vomiting, diarrhea, jaundice, sore throat with fever, infected lesion on hands/exposed arms) and exposure reporting align with FDA Food Code 2-201.11 / Form 1-B. ESL-friendly phrasing ("Tell your manager before your shift - not after").
- A2 Actionability: PASS - "Tell your manager before your shift" is operator-ready. ESL-friendly.
- A3 Completeness/Actuals: PASS - covers symptoms, illnesses, exposure, anti-retaliation, return-to-work mechanism. Signed once at onboarding (per parent tracker / Kevin's note).
- A4 Format/Metadata: PASS - full STD-001 metadata block; CRITICAL callout; clear acknowledgement block with print name / signature / date.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: GOOD - section headers (THE AGREEMENT, ACKNOWLEDGEMENT).
  - number_hygiene: clean.

**Part 3 - Library checks**
- cross_refs_in_text: none in body. The doc body does not reference PB-004 §05 Food Safety, PB-007, or SOP-008 explicitly. Per References Map there is no current entry for FORM-008 - this is a graph addition.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift: none
- legal_flag: LEGAL-REVIEW - this is the FDA-aligned employee health reporting agreement (FDA Food Code Form 1-B basis). Although the content tracks the regulation, counsel should validate the at-will anti-retaliation language and any state-specific add-ons.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Class assignment | Open question per tracker: FORM vs AGR class. The doc is titled "Health Reporting Agreement" and is acknowledged at onboarding via Rippling. If Rippling-acknowledged at onboarding, this fits AGR class (per AGR-001/AGR-002 pattern). If wet-signed and filed by the manager, FORM is appropriate. Currently classed FORM-008 with Acknowledgement & Agreement block (line 95) that matches AGR class anatomy. | Resolve FORM vs AGR class with Mariela (People Ops). Either rename to AGR-NNN with companion AGR class metadata, or keep as FORM-008 and document the Rippling acknowledgement workflow. | yes - confirm Rippling onboarding workflow |
| MAJOR | Related Documents | No Related Documents block. Per PB-004 §05 (References Map line 60) PB-002 governs allergens; this form should cite PB-004 §05, PB-007 (Workplace Safety / employee health), SOP-008 (Food Safety Management), and FDA Food Code Form 1-B for SME. | Add Related Documents block. | no |
| MAJOR | Throughout | LEGAL-REVIEW - regulatory-tied content (FDA Food Code 2-201.11). | Counsel + FDA Food Code validation. | no |
| MINOR | "Why This Matters" | "A sick food handler can put a roster down." Strong floor-language, good. Could explicitly cite the Big 6 reportable diagnoses framework label. | Optional. | no |

**Part 5 - Catalog row draft**
- card_line: "Health Reporting Agreement - report symptoms (vomiting, diarrhea, jaundice, sore throat + fever, infected cut), the Big 6 diagnoses, or exposure. Tell your manager before your shift. No retaliation."
- summary: "FORM-008 is the FDA Food Code-aligned employee health reporting agreement. Each food employee acknowledges they will report (before their shift) any of five symptoms - vomiting, diarrhea, jaundice, sore throat with fever, or an infected cut/wound/boil on hands or exposed arms - and any of the six diagnosed illnesses - Norovirus, Hepatitis A, Shigella, STEC, Salmonella Typhi, and Nontyphoidal Salmonella - plus any exposure (living with or close contact to a diagnosed person). Restriction or exclusion from food handling follows FDA Food Code. Anti-retaliation explicit. Signed at onboarding. CRITICAL Never work around food while you have vomiting or diarrhea."
- keywords: ["health reporting", "FDA Food Code", "Big 6", "Norovirus", "Hepatitis A", "Shigella", "STEC", "Salmonella", "exposure", "vomiting", "diarrhea", "exclusion", "restriction", "onboarding", "FORM-008"]
- shelf_proposed: Safety (alt: HR & People)
- audience_proposed: operator
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no (write it)
- owner_present_role_title: yes (Director of Culinary)
- approver_present: yes (SLT + Director of Culinary)
- summary_keywords_present: no
- chunking_ready_real_headings: GOOD
- Blocks to Live: resolve FORM vs AGR class; add Related Documents; counsel review.

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary) + Mariela (People Ops) + Counsel
- Actual needed from Kevin: confirm acknowledgement workflow (Rippling onboarding vs wet-sign at site); if Rippling, reclassify or document the Rippling acknowledgement path on the doc.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: content is regulator-accurate and ESL-friendly. The class question (FORM vs AGR) is the only structural decision pending; Related Documents block needs to be added.

---

### FORM-009 Knife Skills Verification

**File:** FORM-009_Knife_Skills_Verification_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner = Director of Culinary
**Structure verdict (chunking probe):** GOOD (full STD-001 metadata + sectioned)

**Part 1 - Identification**
- id_from_filename: FORM-009
- id_in_document: FORM-009 (line 12)
- title_matches_tracker: yes ("Knife Skills Verification")
- version_in_document: v1.0
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - 10 competencies are well-formed knife safety items. Mandatory-glove list (mandoline, slicer, deboning, shucking oysters/shellfish, cleaning slicer/food-processor blade) aligns with PB-007 Workplace Safety Manual. Re-verify cadence (annually + after a cut requiring more than self-care) is clear.
- A2 Actionability: PASS - EC-observed competency check with Pass / Needs Work / N/A + Corrective Action column. Operator-ready.
- A3 Completeness/Actuals: PASS - covers grip, board stability, cutting motion, sharpness, knife selection, carrying, passing/placing, falling-knife rule, washing, and working-speed control. CRITICAL callout on mandatory-glove tasks (line 45) is correctly distinguished from the competency-based rule.
- A4 Format/Metadata: PASS - full STD-001 metadata block, sectioned, Related Documents block.
- A5 SousAI-readiness: CRITICAL
  - template_as_canonical_risk: low.
  - chunking_readiness: GOOD.
  - number_hygiene: clean (no figures).

**Part 3 - Library checks**
- cross_refs_in_text: PB-007 (lines 7, 187 - "satellite of PB-007 Workplace Safety Manual"; Related Documents = Live); **REF-009 (lines 43, 193 - "kept in the employee's training record (REF-009)" and Related Documents = Live)** - CRITICAL: REF-009 is RETIRED per manifest §"Retired set"; superseded by Rippling; PB-006 (lines 199 - Related Documents = Live); STD-001 (line 205).
- inbound_retired_pointer: **YES - CRITICAL.** REF-009 is the ServSafe Cert Tracker, RETIRED. Cert tracking lives in Rippling. FORM-009 references it twice: once in body prose ("The signed copy is kept in the employee's training record (REF-009)") and once in Related Documents block labeled "Live."
- contradiction_within_doc: none within the doc; only the retired-pointer issue.
- terminology_drift: none
- legal_flag: no - though glove-rule sets workplace safety expectation, the doc is internal training and the OSHA piece lives in PB-007.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **CRITICAL** | "What This Is" line 43 + Related Documents | Body says "The signed copy is kept in the employee's training record (REF-009)" and Related Documents lists REF-009 ServSafe/Cert Tracker as Live. REF-009 is RETIRED per manifest; cert tracking lives in Rippling. | Replace REF-009 references with "Rippling employee training record" in body, and remove REF-009 from Related Documents (replace with Rippling pointer, not a doc ID). | yes - confirm Rippling is the destination of record |
| MAJOR | Related Documents | PB-006 listed as Live; per manifest PB-006 is "In review (v0.3) Draft - with SLT". Status label is wrong. | Update status to "In review" or "Draft." | no |
| MINOR | "What This Is" | Phrasing "satellite of PB-007 Workplace Safety Manual" is unusual terminology - what does "satellite" mean in the OPD taxonomy? Not defined in STD-001. | Replace with "Implements PB-007" or "Companion to PB-007" per STD-001 vocabulary. | no |
| MINOR | "Knife Technique Competencies" intro | "Any 'Needs work' means the employee is not yet verified" - sets a strict gate. Confirm with Britt this is the intent (no partial verifications). | Confirm and clarify. | yes - confirm partial-verification rule |
| MINOR | "Re-verify" line 171 | "Re-verify - annually, and after any knife-related cut that requires more than self-care." Clear floor; could explicitly cite the SOP-002 incident severity ladder (anything that triggers SOP-002 incident reporting). | Optional add. | no |

**Part 5 - Catalog row draft**
- card_line: "Knife Skills Verification - EC observes 10 competencies. Until verified, the cut-resistant glove is required. After verification, it is recommended. Mandoline/slicer/deboning/shucking are always mandatory."
- summary: "FORM-009 is the EC-observed knife competency check that gates PB-007's cut-resistant glove rule. The Executive Chef observes the employee at the board and marks 10 competencies (grip & control, stable workstation, cutting away from body, sharpness, knife selection, safe carrying, safe passing/placing, never reaching for a falling knife, safe cleaning, control at working speed). Until verified, the glove is required on the guiding hand for all knife work. Once verified, the glove is recommended but optional for routine knife work. Mandatory-glove tasks (mandoline, slicer, deboning, shucking, cleaning slicer/processor blades) never become optional. Re-verify annually or after any knife cut requiring more than self-care. The signed record files in the employee's Rippling training record."
- keywords: ["knife skills", "cut-resistant glove", "verification", "PB-007", "competency", "mandoline", "slicer", "deboning", "Executive Chef", "Rippling", "training record", "FORM-009"]
- shelf_proposed: Safety (alt: Culinary)
- audience_proposed: operator (EC-facing primarily)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes (Director of Culinary)
- approver_present: yes (SLT)
- summary_keywords_present: no
- chunking_ready_real_headings: GOOD
- Blocks to Live: **CRITICAL retired-pointer fix on REF-009**; PB-006 status label fix; "satellite" terminology fix.

**Part 7 - SME/actuals**
- SME: Britt (Dir Culinary) - partial-verification rule, retired-pointer correction
- Actual needed from Kevin: confirm Rippling as the destination of record for the signed copy; confirm any-Needs-Work gate (strict / lenient).

**Part 8 - Verdict**
- NOT-READY
- Rationale: the body and Related Documents both point at REF-009 as Live; REF-009 is retired. This is a CRITICAL fix before live.

---

### REF-006 Hourly Pay Bands

**File:** REF-006_Hourly_Pay_Bands_v1_1.txt
**Tracker status / version:** In review (v1.1), Owner = People Operations, **Restricted**
**Structure verdict (chunking probe):** GOOD (numbered sections, version history, related docs)

**Part 1 - Identification**
- id_from_filename: REF-006
- id_in_document: REF-006 (line 12)
- title_matches_tracker: yes ("Hourly Pay Bands")
- version_in_document: v1.1 · Draft - market reference (pending Finance validation)
- version_in_tracker: v1.1
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: ISSUES - **Illinois is missing from §03 Hourly Bands by Market.** Eight operating states per KitchFix conventions list (AZ, FL, IL, KY, MO, NY, OH, TX); REF-006 §03 has only 7 (AZ, FL, TX, NY, MO, OH, KY). Version History §05 explicitly names "seven operating states" - so this is a content gap, not a typo. Also: 2026 state minimum wages listed (AZ $15.15, FL $14.00 -> $15.00 Sept 30 2026, NY Buffalo $16.00, MO $15.00, OH $11.00). Cannot confirm precise figures here - flag for Finance/Counsel validation.
- A2 Actionability: PASS - bands by market with role / min / mid / max. Band-position model (lower-third / midpoint / upper-third) tied to merit logic per POL-007. Compression review explicit. Restricted-class caveat clearly stated.
- A3 Completeness/Actuals: ISSUES - draft market reference pending Finance + People Ops validation. The doc self-discloses this ("draft market reference (pending Finance validation)", "planning baseline, not a final structure"). For SousAI corpus the pay numbers themselves are a hygiene risk - Sous could quote them as fact.
- A4 Format/Metadata: PASS - full STD-001 metadata block + Contents + Sections + Version History + Related Documents. POL-class condensed format is NOT applicable here (this is REF class); structure is GOOD.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: medium - draft band values could be retrieved as fact.
  - chunking_readiness: GOOD - explicit numbered sections and sub-headings by state.
  - number_hygiene: **flag** - all band values + state minimum wages are unverified estimates per the doc's own self-disclosure ("Draft market reference. Validate against Rippling actuals and account budgets before adoption"). Sous retrievals should carry a "draft - pending Finance validation" caveat or be excluded from corpus until validated.

**Part 3 - Library checks**
- cross_refs_in_text: POL-007 (multiple); REF-007 (multiple); FORM-007 (Related Documents line 415); STD-001 (line 421). All match References Map line 73.
- inbound_retired_pointer: NO
- contradiction_within_doc: **Version History contradicts the operating-states list.** §05 v1.0 entry says "the seven operating states (AZ, FL, TX, NY, MO, OH, KY)"; KitchFix conventions §2 lists 8 operating states (AZ, FL, IL, KY, MO, NY, OH, TX). IL is missing in §03 and in §05.
- terminology_drift: none significant. "People Operations" used. "Site leadership" used correctly.
- legal_flag: LEGAL-REVIEW - state minimum wage figures and Florida $14.00 -> $15.00 Sept 30 2026 transition need Counsel/Finance validation; any error here has wage-and-hour exposure.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **CRITICAL** | §03 Hourly Bands by Market + §05 Version History | **Illinois is missing.** KitchFix operates in 8 states (AZ, FL, IL, KY, MO, NY, OH, TX); REF-006 covers only 7. Version History line 387 explicitly says "seven operating states." | Add Illinois (Schaumburg / Geneva / wherever the IL account is sited) with role / min / mid / max bands; correct Version History wording. | yes - need the IL site location + market rates from Finance |
| **CRITICAL** | §03 all bands (number hygiene) | All pay band figures are explicitly "draft market reference (pending Finance validation)" - any SousAI retrieval risks quoting as fact. | Hold from SousAI corpus until validated, OR add an explicit "DRAFT - pending Finance validation" flag at the top of every band table so Sous chunks carry the caveat. | yes - confirm Finance validation timeline |
| MAJOR | §03 all state minimum wage figures | State minimum wage figures (AZ $15.15, FL $14.00 -> $15.00, NY Buffalo $16.00, MO $15.00, OH $11.00) are regulatory-tied. Cannot verify here. | Counsel/Finance validate against current state law. | yes - validate state min wage figures |
| MAJOR | Restricted-class handling | RESTRICTED classification correctly noted. SousAI corpus needs to respect this - confirm the audience filter on this doc. | Confirm RESTRICTED filter in catalog. | no |
| MINOR | §03 "FOH Attendant" | Role labeled "FOH Attendant" here but JD TEMPLATE doc names "Café Attendant." Terminology drift between docs. | Pick one canonical role name. | yes - confirm canonical role name |

**Part 5 - Catalog row draft**
- card_line: "Hourly Pay Bands by market (AZ/FL/TX/NY/MO/OH/KY - IL missing). Min/mid/max for Dishwasher, Cook, FOH Attendant. Draft - pending Finance validation. Restricted to management."
- summary: "REF-006 holds the hourly pay ranges for the three hourly roles (Dishwasher, Cook, FOH Attendant) by operating market. Each band has a minimum, midpoint, and maximum. Where an employee sits reflects experience and sustained performance. Currently covers seven of KitchFix's eight operating states (Illinois is missing as of v1.1). State minimum wage floors respected (Arizona Goodyear/Surprise $15.15; Florida Jupiter/Dunedin/Port Charlotte $14.00 to $15.00 by Sept 30 2026; New York Buffalo $16.00; Missouri St. Louis $15.00; Ohio Cincinnati $11.00). DRAFT market reference pending People Operations + Finance validation against Rippling actuals and account budgets. Restricted to site leadership - not for posting or distribution to hourly staff."
- keywords: ["pay bands", "hourly", "compensation", "POL-007", "FORM-007", "Dishwasher", "Cook", "FOH Attendant", "Arizona", "Florida", "Texas", "New York", "Missouri", "Ohio", "Kentucky", "Illinois", "minimum wage", "REF-006"]
- shelf_proposed: HR & People (alt: Finance)
- audience_proposed: corporate / leadership (RESTRICTED)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes (People Operations)
- approver_present: pending - People Ops + Finance
- summary_keywords_present: no
- chunking_ready_real_headings: GOOD
- Blocks to Live: add IL market; Finance validation of all band values + state minimum wages; restricted-audience filter in catalog.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops) + Sebastian (Accounting/Finance)
- Actual needed from Kevin: confirm IL operating-site location + which IL market wage applies (Chicago/Schaumburg / etc.); confirm Finance validation date for band values + state min wage figures.

**Part 8 - Verdict**
- NOT-READY
- Rationale: IL state missing is a CRITICAL completeness gap (doc covers 7 of 8 operating states); all band values are explicitly draft pending Finance validation. Hold from SousAI corpus until validated or carry an explicit DRAFT flag through retrieval.

---

### REF-007 Leadership Pay Bands

**File:** REF-007_Leadership_Pay_Bands_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner = People Operations, **Restricted - corporate-only**
**Structure verdict (chunking probe):** GOOD (numbered sections, version history, related docs)

**Part 1 - Identification**
- id_from_filename: REF-007
- id_in_document: REF-007 (line 12)
- title_matches_tracker: yes ("Leadership Pay Bands")
- version_in_document: v1.0 · Draft - market reference (pending Finance validation)
- version_in_tracker: v1.0
- metadata_finding: PASS - aligned

**Part 2 - Document-level**
- A1 Accuracy: PASS - national bands (Sous Chef, Hospitality Manager, Executive Chef) with min / mid / max. No state-by-state mapping (national + scope adjustment). High-cost-market 5-10% adjustment noted (line 127).
- A2 Actionability: PASS - explicit role definitions; band position tied to account scope (PDC vs MiLB vs standard MLB vs flagship/dual clubhouse).
- A3 Completeness/Actuals: ISSUES - DRAFT market reference pending Finance validation. Same hygiene risk as REF-006.
- A4 Format/Metadata: PASS - full STD-001 metadata block + Contents + Sections + Version History + Related Documents.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: medium - draft salary values could be retrieved as fact.
  - chunking_readiness: GOOD.
  - number_hygiene: **flag** - all salary band values + the "5-10%" higher-cost-market adjustment are unverified estimates per the doc's own disclosure. Restricted to corporate; SousAI corpus needs to enforce this.

**Part 3 - Library checks**
- cross_refs_in_text: POL-007 (line 55, 179); REF-006 (line 55, 185); FORM-007 (line 191); STD-001 (line 197). All match References Map line 73 (REF-006/REF-007 governed by POL-007).
- inbound_retired_pointer: NO
- contradiction_within_doc: none.
- terminology_drift: "site-leadership triad" used here (line 55, 91); "site triad" used elsewhere in conventions. Consistent enough.
- legal_flag: no - salary values are not regulator-tied beyond minimum wage (which is not at issue at these levels), but the doc handling (restricted) needs counsel-aligned confidentiality controls.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **CRITICAL** | §03 Leadership Bands (number hygiene) | All salary band figures ($52k-$72k Sous, $55k-$82k HM, $80k-$120k EC) are explicitly "draft market reference (pending Finance validation)" - SousAI retrieval risks quoting as fact, especially because audience is corporate (where decisions are made on these numbers). | Hold from SousAI corpus until validated, OR add explicit "DRAFT - pending Finance validation" flag at the top of the band table. | yes - confirm Finance validation timeline |
| MAJOR | RESTRICTED handling | Doc is correctly classed as restricted corporate-only. SousAI corpus needs to enforce this restriction; doc should NOT be retrieved by site leadership queries. | Confirm audience filter in catalog (corporate-only). | yes - confirm RESTRICTED audience filter is enforced |
| MINOR | §03 high-cost-market adjustment line 127 | "Add roughly 5-10% in higher-cost markets such as Buffalo and Phoenix." Soft figure. | Tighten with Finance to a structural percentage (e.g., "+8% Buffalo, +6% Phoenix"). | yes |
| MINOR | §03 examples | "a dual-clubhouse or flagship MLB account (e.g., TXR Home + Visitor, STL, CIN) sits top-of-band" - account names cited as examples. Operational fact, not placeholder, but Sous could quote specific account names. | Acceptable; flagged for awareness only. | no |

**Part 5 - Catalog row draft**
- card_line: "Leadership Pay Bands - national, by role (Sous, HM, Exec Chef) and account scope. DRAFT - pending Finance validation. Restricted corporate-only."
- summary: "REF-007 holds the annual salary ranges for the site-leadership triad (Sous Chef, Hospitality Manager, Executive Chef). Bands are national and calibrated by account scope: a PDC or MiLB account sits in the lower third; a standard MLB account sits at midpoint; a flagship or dual-clubhouse MLB account (e.g., TXR Home + Visitor, STL, CIN) sits in the upper third. Roughly 5-10% adjustment in higher-cost markets such as Buffalo and Phoenix. Sous Chef $52,000-$72,000; Hospitality Manager $55,000-$82,000; Executive Chef $80,000-$120,000. DRAFT market reference pending People Operations + Finance validation against Rippling actuals and account budgets. RESTRICTED - corporate, People Operations, Finance, and approving leadership only; NOT shared with site management."
- keywords: ["leadership pay", "salary bands", "Sous Chef", "Hospitality Manager", "Executive Chef", "REF-007", "POL-007", "FORM-007", "restricted", "corporate-only"]
- shelf_proposed: HR & People (alt: Finance)
- audience_proposed: corporate (RESTRICTED, corporate-only)
- status_proposed_opd_enum: In review - pending CK-2 confirmation

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: yes (People Operations)
- approver_present: pending - People Ops + Finance
- summary_keywords_present: no
- chunking_ready_real_headings: GOOD
- Blocks to Live: Finance validation; restricted-audience filter at catalog level.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops) + Sebastian (Accounting/Finance)
- Actual needed from Kevin: confirm RESTRICTED corporate-only audience filter is enforced in SousAI; confirm Finance validation date.

**Part 8 - Verdict**
- NOT-READY (corpus-side)
- Rationale: salary values are explicitly draft pending Finance validation; restricted audience filter must be enforced before exposure. Content structure is otherwise solid and ready to graduate to Live once values validated.

---

### JD TEMPLATE - Cook (no doc ID)

**File:** JD TEMPLATE - Cook.txt
**Tracker status / version:** Not in tracker (no doc ID assigned)
**Structure verdict (chunking probe):** THIN / FLAT-RISK (Title style only; no STD-001 anatomy)

**Part 1 - Identification**
- id_from_filename: none (filename is "JD TEMPLATE - Cook")
- id_in_document: none - line 1 has "[TITLE] Internal JD - Cook"
- title_matches_tracker: n/a (not in tracker)
- version_in_document: none
- version_in_tracker: n/a
- metadata_finding: **MAJOR - no doc ID, no version, no metadata block. Needs TPL-NNN assignment per tracker open question.**

**Part 2 - Document-level**
- A1 Accuracy: ISSUES - "8 states" claim (line 19) matches conventions. References "3+ years experience" - operational hiring bar, not factual claim.
- A2 Actionability: ISSUES - intended as a template (fill-in-the-blank for [TEAM], [MANAGER], [LOCATION], [$XX-$XX/hour]). Operator-actionable if treated as TPL class with instructions block + sample row per STD-001.
- A3 Completeness/Actuals: ISSUES - significant fill-in-the-blank placeholders: [Stadium Name & Address], [MANAGER TITLE], [TEAM], [$XX-$XX/hour], [Location]. Hard-coded "3+ year experience" + "$XX/hour" placeholder + "ability to lift up to 50 lbs" + "8 states" + "Food Handler/ServSafe certification (or willingness to obtain)" + "background check and drug screening." Pay range placeholders are clearly intentional and will be filled per REF-006 at posting time.
- A4 Format/Metadata: FAIL - no STD-001 metadata block, no doc ID, no version, no owner, no approved-by, no related documents block. Title-only structure.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: HIGH - placeholder content like "$XX/hour", "3+ year experience", "50 lbs lift" could be retrieved as job posting fact. Sous could state a Cook salary is "$XX/hour" or list any-specific pay or commit.
  - chunking_readiness: FLAT-RISK - "[TITLE]" markers but no real H1/H2/H3.
  - number_hygiene: poor - "$XX-$XX/hour" placeholders throughout; "$XX/hour" repeated. "3+ year experience" - is this 3 years or "3+ year"? Grammar issue suggests doc is unedited.

**Part 3 - Library checks**
- cross_refs_in_text: none. Doc does not cite POL-007, REF-006, FORM-008, FORM-009, AGR-001, PB-002, SOP-008, or any other related doc.
- inbound_retired_pointer: NO
- contradiction_within_doc: none significant.
- terminology_drift: none - "best-in-class hospitality" matches brand-promise variants but not the canonical "Best Food, Best Service, Best Hospitality." Mild drift.
- legal_flag: LEGAL-REVIEW - EEO statement at the end (line 75) is a standard formulation; counsel should validate state-by-state addenda (e.g., CROWN Act / state-specific protected classes). Background check and drug screening language (line 101) may need state-specific notice triggers.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **MAJOR** | Header / metadata | No doc ID, no version, no STD-001 metadata block. Per tracker open question, needs TPL-NNN assignment. | Assign TPL-NNN per tracker reconciliation step; add full STD-001 TPL-class metadata block (instructions block + sample row per STD-001 TPL anatomy). | yes - assign TPL-NNN |
| MAJOR | Throughout (number hygiene) | Pay placeholders "$XX-$XX/hour" and "$XX/hour" are not flagged as instruction-block content; Sous could retrieve as fact. | Per STD-001 TPL class: place an instructions block at top + a single sample row clearly labeled "EXAMPLE" so Sous chunks carry the example tag. | no |
| MAJOR | Brand promise (line 19) | "best-in-class hospitality through exceptional food and unmatched service" drifts from the canonical "Best Food, Best Service, Best Hospitality" brand promise. | Update to canonical wording. | no |
| MAJOR | Body | No Related Documents block citing the catalog this template depends on (REF-006 for pay, FORM-008 for health, PB-002 allergens, AGR-001 The Big Rules at hire). | Add Related Documents block. | no |
| MINOR | Qualifications | "3+ year experience" - typo (should be "years"). | Fix typo. | no |
| MINOR | EEO statement (line 75) | Standard language but worth counsel review for state addenda. | LEGAL-REVIEW. | no |

**Part 5 - Catalog row draft**
- card_line: "Cook job description template - fill in team, location, pay, and post on Greenhouse / Indeed. Reports to EC or assigned manager."
- summary: "TPL-NNN (pending assignment): Internal Job Description template for the Cook role. Captures responsibilities (cross-train all stations, receive/store orders, uphold product standards, sanitation, professional service), qualifications (3+ years professional kitchen experience, kitchen equipment knowledge, sanitary practices), schedule (non-standard work week including early mornings/evenings/weekends/holidays), and Total Rewards (competitive wage + benefits for full-time roles). Companion Job Advertisement block for Greenhouse / Indeed external posting. Pay range filled per REF-006."
- keywords: ["job description", "JD", "Cook", "hiring", "Greenhouse", "Indeed", "template", "TPL"]
- shelf_proposed: HR & People
- audience_proposed: corporate (hiring managers)
- status_proposed_opd_enum: NOT yet in catalog - needs TPL-NNN assignment

**Part 6 - Live-readiness**
- version_present: no
- card_line_present: no
- owner_present_role_title: no
- approver_present: no
- summary_keywords_present: no
- chunking_ready_real_headings: no
- Blocks to Live: TPL-NNN assignment; full STD-001 TPL-class anatomy; brand-promise wording fix; Related Documents block; counsel review on EEO.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops) + hiring lead per account
- Actual needed from Kevin: assign TPL-NNN; confirm canonical hiring requirements (ServSafe/Allergen at hire vs at first shift); confirm pay range filling workflow per REF-006.

**Part 8 - Verdict**
- NOT-READY
- Rationale: no doc ID, no metadata block, no Related Documents, brand-promise drift, EEO counsel review pending. Needs structural overhaul to graduate to TPL class.

---

### JD TEMPLATE - Dishwasher (no doc ID)

**File:** JD TEMPLATE - Dishwasher.txt
**Tracker status / version:** Not in tracker (no doc ID assigned)
**Structure verdict (chunking probe):** THIN / FLAT-RISK (Title style only; no STD-001 anatomy)

**Part 1 - Identification**
- id_from_filename: none
- id_in_document: none - line 1 has "[TITLE] Internal JD - Dishwasher"
- title_matches_tracker: n/a (not in tracker)
- version_in_document: none
- version_in_tracker: n/a
- metadata_finding: **MAJOR - same as Cook template, needs TPL-NNN assignment.**

**Part 2 - Document-level**
- A1 Accuracy: PASS - "1+ years of Dishwashing or Kitchen experience preferred" is a typical hiring bar.
- A2 Actionability: ISSUES - same template pattern, fill-in placeholders.
- A3 Completeness/Actuals: ISSUES - same placeholder pattern as Cook template.
- A4 Format/Metadata: FAIL - no STD-001 metadata block.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: HIGH - placeholder content could be retrieved as fact.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: poor - "$XX-$XX/hour" placeholders, "1+ years" experience.

**Part 3 - Library checks**
- cross_refs_in_text: none.
- inbound_retired_pointer: NO
- contradiction_within_doc: none.
- terminology_drift: same brand-promise drift as Cook.
- legal_flag: LEGAL-REVIEW (same EEO + background check + drug screening pattern as Cook).

**Part 4 - Findings**
Same pattern as JD TEMPLATE - Cook above. Summary:
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **MAJOR** | Header / metadata | No doc ID, no STD-001 metadata. | Assign TPL-NNN + add metadata block. | yes |
| MAJOR | Throughout (number hygiene) | Pay placeholders "$XX/hour" embedded. | Wrap in instruction-block + sample-row TPL anatomy. | no |
| MAJOR | Brand promise (line 19) | Drift from canonical brand promise. | Fix wording. | no |
| MAJOR | Body | No Related Documents block. | Add. | no |
| MINOR | EEO statement | Counsel review for state addenda. | LEGAL-REVIEW. | no |

**Part 5 - Catalog row draft**
- card_line: "Dishwasher job description template - fill in team, location, pay, and post on Greenhouse / Indeed."
- summary: "TPL-NNN (pending assignment): Internal Job Description for the Dishwasher role. Maintains cleaning schedule of all equipment, sanitation between food items, water temperature/chemical regulation, facility cleanliness, light prep, stock rotation. 1+ years dishwashing or kitchen experience preferred. Pay range filled per REF-006. Companion Job Advertisement block for Greenhouse / Indeed."
- keywords: ["job description", "JD", "Dishwasher", "hiring", "template", "TPL"]
- shelf_proposed: HR & People
- audience_proposed: corporate (hiring managers)
- status_proposed_opd_enum: NOT yet in catalog - needs TPL-NNN assignment

**Part 6 - Live-readiness**
- Same as Cook template; all blocks missing.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops)
- Actual needed from Kevin: assign TPL-NNN; same as Cook.

**Part 8 - Verdict**
- NOT-READY
- Rationale: same as Cook template - structural overhaul needed.

---

### JD TEMPLATE - Café Attendant (no doc ID)

**File:** JD TEMPLATE - Café Attendant.txt
**Tracker status / version:** Not in tracker (no doc ID assigned)
**Structure verdict (chunking probe):** THIN / FLAT-RISK

**Part 1 - Identification**
- id_from_filename: none
- id_in_document: none - line 1 has "[TITLE] Internal JD (Hourly Positions)" - this is the WEAKEST title line of the four (does not name the role; lines 7 below clarify "Job Title: Café Attendant").
- title_matches_tracker: n/a (not in tracker)
- version_in_document: none
- version_in_tracker: n/a
- metadata_finding: **MAJOR - same as the others, plus weakest title-line of the four.**

**Part 2 - Document-level**
- A1 Accuracy: ISSUES - "Ensure hot food temperatures are within safe range and records temps" (line 43) is correctly altitude-set but does not cite the canonical 135F hot floor (cf. SOP-002 anchor temps). For an hourly JD this is acceptable, but a Sous-retrieved chunk could miss the canonical number.
- A2 Actionability: ISSUES - same template pattern.
- A3 Completeness/Actuals: ISSUES - placeholder pattern; "2 to 3 years customer service experience preferred" - operational.
- A4 Format/Metadata: FAIL.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: HIGH.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: poor.

**Part 3 - Library checks**
- cross_refs_in_text: none. Should reference PB-002 (allergens), FORM-008 (health), AGR-001 (Big Rules at hire), REF-006 for pay.
- inbound_retired_pointer: NO
- contradiction_within_doc: none.
- terminology_drift: **role-name drift.** Doc names role "Café Attendant"; REF-006 §03 names role "FOH Attendant." Inconsistent canonical role naming across the two docs in this batch. Brand-promise drift line 19 (same pattern). Quoted phrase "Best in Class" hospitality (line 29) is close to brand promise.
- legal_flag: LEGAL-REVIEW (same EEO pattern).

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **MAJOR** | Title line 1 | "[TITLE] Internal JD (Hourly Positions)" does not name the role - other JD templates name the role in title line. | Add role name in title line. | no |
| **MAJOR** | Header / metadata | No doc ID, no STD-001 metadata. | Assign TPL-NNN + add metadata block. | yes |
| **MAJOR** | Role naming | "Café Attendant" here vs "FOH Attendant" in REF-006 §03. Pick one canonical role name. | Reconcile canonical role name across REF-006 and JD TEMPLATE. | yes |
| MAJOR | Body | No Related Documents block. | Add REF-006, FORM-008, PB-002, AGR-001 references. | no |
| MAJOR | Brand promise (line 19) | Drift from canonical brand promise. | Fix wording. | no |
| MINOR | §Responsibilities line 43 | "Ensure hot food temperatures are within safe range" doesn't cite 135F. | Add reference to SOP-008 hot-hold floor or PB-002 if any allergen handling. | no |
| MINOR | EEO statement | Counsel review for state addenda. | LEGAL-REVIEW. | no |

**Part 5 - Catalog row draft**
- card_line: "Café/FOH Attendant job description template - manages dining presentation, cleanliness, client experience. Hot-hold temp records. Reports to EC/Sous."
- summary: "TPL-NNN (pending assignment): Internal Job Description for the Café (or FOH) Attendant role. Provides Best-in-Class hospitality, manages food service area presentation and cleanliness, dining area stocking, hot food temperature recording, light prep / dishwashing support. 2-3 years customer service preferred. Pay range filled per REF-006."
- keywords: ["job description", "JD", "Café Attendant", "FOH Attendant", "hiring", "hospitality", "presentation", "template", "TPL"]
- shelf_proposed: HR & People
- audience_proposed: corporate (hiring managers)
- status_proposed_opd_enum: NOT yet in catalog - needs TPL-NNN assignment + role-name reconciliation

**Part 6 - Live-readiness**
- Same as Cook template; plus role-name reconciliation.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops) + Britt (Dir Culinary, role-name canonical)
- Actual needed from Kevin: reconcile "Café Attendant" vs "FOH Attendant"; assign TPL-NNN.

**Part 8 - Verdict**
- NOT-READY
- Rationale: structural overhaul + role-name reconciliation with REF-006 + brand-promise fix.

---

### JD TEMPLATE - Culinary Delivery Driver (no doc ID)

**File:** JD TEMPLATE - Culinary Delivery Driver.txt
**Tracker status / version:** Not in tracker (no doc ID assigned)
**Structure verdict (chunking probe):** THIN / FLAT-RISK

**Part 1 - Identification**
- id_from_filename: none
- id_in_document: none - line 1 has "[TITLE] Internal JD - Driver"
- title_matches_tracker: n/a
- version_in_document: none
- version_in_tracker: n/a
- metadata_finding: **MAJOR - same as others.**

**Part 2 - Document-level**
- A1 Accuracy: PASS - "Valid driver's license with a clean driving record" matches SOP-010 Driver/Fleet Safety SOP context.
- A2 Actionability: ISSUES - same template pattern.
- A3 Completeness/Actuals: ISSUES - same placeholder pattern.
- A4 Format/Metadata: FAIL.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: HIGH.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: poor.

**Part 3 - Library checks**
- cross_refs_in_text: none. Should reference SOP-010 Driver/Fleet Safety, FORM-002 Vehicle Incident Worksheet, AGR-001 Big Rules, REF-006 for pay.
- inbound_retired_pointer: NO
- contradiction_within_doc: none.
- terminology_drift: brand-promise drift line 19.
- legal_flag: LEGAL-REVIEW - driver role has MVR + drug screening + commercial driving exposure. Counsel should validate state-specific driver hiring requirements (CDL or not? insurance threshold?).

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| **MAJOR** | Header / metadata | No doc ID, no STD-001 metadata. | Assign TPL-NNN + add metadata block. | yes |
| MAJOR | Body | No Related Documents block; should reference SOP-010 and FORM-002. | Add Related Documents block. | no |
| MAJOR | Brand promise (line 19) | Drift from canonical brand promise. | Fix wording. | no |
| MAJOR | Qualifications | Driver-role qualifications minimal: only "Valid driver's license with a clean driving record" + "Strong time management" + "Professional appearance." Per SOP-010 there may be insurance/MVR/drug-test/CDL gates. | Cross-check with SOP-010 for full hiring qualifications. | yes |
| MINOR | EEO statement | Counsel review for state addenda + driver-specific FCRA/MVR-disclosure rules. | LEGAL-REVIEW. | no |

**Part 5 - Catalog row draft**
- card_line: "Culinary Delivery Driver job description template - delivers catered orders, verifies accuracy, sets up displays, daily kitchen duties as assigned."
- summary: "TPL-NNN (pending assignment): Internal Job Description for the Culinary Delivery Driver role. Loads, transports, and delivers catering orders safely and on time; verifies order accuracy before departure and on delivery; sets up food displays; follows food safety, sanitation, and handling procedures; maintains delivery vehicles and equipment; assists with kitchen and prep duties as directed. Valid driver's license with clean record required. Companion to SOP-010 Driver/Fleet Safety. Pay range filled per REF-006."
- keywords: ["job description", "JD", "driver", "delivery", "SOP-010", "FORM-002", "hiring", "template", "TPL"]
- shelf_proposed: HR & People (alt: Operations)
- audience_proposed: corporate (hiring managers)
- status_proposed_opd_enum: NOT yet in catalog - needs TPL-NNN assignment

**Part 6 - Live-readiness**
- Same as Cook template; plus SOP-010 cross-check.

**Part 7 - SME/actuals**
- SME: Mariela (People Ops) + HR (SOP-010 owner) + Counsel (FCRA/MVR)
- Actual needed from Kevin: assign TPL-NNN; cross-check driver qualifications against SOP-010; confirm MVR/insurance/CDL gates.

**Part 8 - Verdict**
- NOT-READY
- Rationale: structural overhaul + driver-specific qualifications cross-check with SOP-010 + counsel review.

---

## Cross-batch observations

### Contradictions BETWEEN docs in this batch

1. **Role naming - REF-006 vs JD TEMPLATE - Café Attendant.** REF-006 §03 names the third hourly role "FOH Attendant"; JD TEMPLATE names it "Café Attendant." Reconcile canonical role name across the catalog. Other two hourly roles (Cook, Dishwasher) match cleanly.

2. **Pay-band scope hole - REF-006 missing IL.** KitchFix conventions list 8 operating states (AZ, FL, IL, KY, MO, NY, OH, TX). REF-006 §03 covers 7 (AZ, FL, TX, NY, MO, OH, KY). REF-006 §05 Version History explicitly says "seven operating states." This is a CRITICAL completeness gap that will affect FORM-007 workflows for any Illinois site. JD TEMPLATEs reference "8 states" - so the JD body claims 8 while the band reference covers 7.

3. **REF-009 retired-pointer in FORM-009.** FORM-009 references REF-009 twice (body + Related Documents) as the destination of the signed knife verification record. Per the manifest §"Retired set," REF-009 is RETIRED - cert tracking lives in Rippling. This is a CRITICAL finding and the most important fix in this batch.

### Terminology drift PATTERNS across the batch

1. **"People Operations" used in SOP-004 family forms (FORM-003/004/005/006) where tracker owner is HR.** Convention list flags this. Pattern is consistent within the SOP-004 family - so it is either a deliberate naming choice (People Ops as the function that owns the SOP-004 family operationally) or a drift. Surface for Mariela to confirm.

2. **Brand-promise drift in all 4 JD TEMPLATEs.** "best-in-class hospitality through exceptional food and unmatched service" appears in all four JD About-KitchFix paragraphs; canonical brand promise per conventions is "Best Food, Best Service, Best Hospitality." Fix once across all four templates.

3. **STD-001 metadata-block adoption is inconsistent across the FORM class.** FORM-007, FORM-008, FORM-009 all carry the full STD-001 metadata block. FORM-003, FORM-004, FORM-005, FORM-006 do not. The SOP-004 family forms were authored on an older template - they need a print-format pass.

### Pay-band hygiene pattern

REF-006 and REF-007 are both self-flagged as "DRAFT - pending Finance validation." Both are restricted. Risk: if either is loaded into the SousAI corpus without a DRAFT label, Sous could quote band values as canonical. Recommend either holding both from corpus until Finance validates, or wrapping retrieval chunks with a "DRAFT - pending Finance validation, do not quote as final" caveat at chunk-creation time.

### JD TEMPLATE catalog readiness

None of the four JD TEMPLATEs are catalog-ready. All four need:
- TPL-NNN assignment (4 IDs)
- STD-001 TPL-class anatomy (instructions block + sample row + metadata block)
- Brand-promise wording correction
- Related Documents block (REF-006, FORM-008, PB-002, AGR-001 at minimum; Driver template adds SOP-010 + FORM-002)
- LEGAL-REVIEW on EEO statement + state-specific addenda + (Driver) FCRA/MVR rules
- Role-name reconciliation with REF-006 (Café vs FOH Attendant)
- Pay-placeholder hygiene so Sous does not quote "$XX/hour" as fact

### Class question worth surfacing

FORM-008 Health Reporting Agreement carries an "Acknowledgement & Agreement" block at line 95 matching AGR-class anatomy more than FORM-class. Per Kevin's note, if Rippling-acknowledged at onboarding the doc fits AGR class better. Suggest reclassifying to AGR-NNN if the workflow is Rippling-driven. Pending Kevin/Mariela confirmation of acknowledgement workflow.
