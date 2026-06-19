# OPD Audit - Batch A Scorecards (Universal POLs)

**Batch:** POLs Universal (8 docs)
**Scorer:** Phase 2 audit subagent
**Date:** 2026-06-14
**Convention notes applied:**
- Em-dashes in body docs are intentional per STD-001; not flagged.
- Condensed POL format (no version-history section) is intentional; not flagged.
- All 8 docs are FLAT-RISK per MANIFEST (no `[H1]`/`[H2]`/`[H3]` heading markers in extracted text - chunking will treat each as one blob unless heading styles are present in the source docx).
- All 8 are tagged "In review (v1.0)" with People Operations owner (POL-019 = Finance owner) and require counsel review before Live (per Audit Brief).

---

### POL-006 Anti-Harassment Policy

**File:** POL-006_Anti-Harassment_Policy_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - no `[H1]`/`[H2]`/`[H3]` markers in extracted text; 8 numbered SECTION blocks but no Word heading styles surface in extraction.

**Part 1 - Identification**
- id_from_filename: POL-006
- id_in_document: POL-006 (matches)
- title_matches_tracker: yes ("Anti-Harassment Policy")
- version_in_document: "v1.0 · Draft"
- version_in_tracker: v1.0 (matches)
- metadata_finding: MINOR - version line reads "v1.0 · Draft" but every other Batch A POL reads "v1.0" cleanly without the "Draft" suffix. Inconsistent metadata convention across the POL set.

**Part 2 - Document-level**
- A1 Accuracy: PASS - no food-safety temps; substantive policy claims (good-faith protection, single-incident sufficiency, manager duty to escalate) read as standard anti-harassment language. Counsel-confirmation needed before Live per audit brief.
- A2 Actionability: PASS - reporting paths are concrete and named ("Mariela Chavez, People Operations Generalist"; Site Leader; Sr Dir Ops; VP of Ops). "If it involves Club Personnel" branch is operator-actionable.
- A3 Completeness/Actuals: ISSUES - §04 says "Contact details for the people above are in your onboarding materials" - this defers to a non-OPD artifact and may be brittle if onboarding kit drifts. No phone/email/Rippling-link to the People Ops contact in-doc. Reasonable for a print policy but if Sous retrieves this it points users to "onboarding materials" rather than a callable contact.
- A4 Format/Metadata: ISSUES - No "APPROVED BY" field in metadata block (other Batch A POLs have "APPROVED BY: Counsel + SLT"). Version reads "v1.0 · Draft" - inconsistent. Owner reads "People Operations" - this is the team name, not a role title per STD-001 §10 which says owner is role title; "Director of People Operations" or "People Operations Generalist" would be the role-title form. See terminology_drift below.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - this is a real policy, not a template.
  - chunking_readiness: FLAT-RISK - extracted text has no `[H1]`/`[H2]`/`[H3]` markers. 8 SECTION-numbered blocks + 1 Related Documents block. Without true Word heading styles the doc will chunk as one blob.
  - number_hygiene: §05 says "typically within 30 days" for review - this is a real-policy commitment Sous may quote. Confirm 30-day target is intended as policy floor.

**Part 3 - Library checks**
- cross_refs_in_text:
  - SOP-004 (§07 Consequences & Accountability) - status: not labeled in body; Related Docs row labels it "Referenced" (not "Live (v1.x)" like the others).
  - STD-001, POL-001, SOP-004, PB-004 (Related Docs block at end).
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Doc names owner "People Operations" - this is the People Ops "department" name used as owner. Per `MEMORY.md > project_opd_owner_field_sweep`, 11 OPD docs are flagged for the owner-field sweep; this is one of them. Per STD-001 §10 owner should be a role title. Deferred to per-doc sweep batch per the Memory note - flagged here for traceability.
  - MINOR: Body uses "People Operations" alongside "Mariela Chavez, People Operations Generalist" - both are the same convention; consistent within the doc. The drift is at the library level (some docs say "People Operations," some say "Human Resources" - see PB-004 / SOP-004 cluster in the owner-sweep memory note).
- legal_flag: LEGAL-REVIEW required - all of §01-§08. The audit brief and manifest already flag "Counsel review required" before Live; counsel must validate harassment, retaliation, and good-faith-report language for every state KitchFix operates in. Tracker = "Counsel review required."

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | No "APPROVED BY" field in metadata block (other Batch A POLs include "Counsel + SLT"); version reads "v1.0 · Draft" while peer POLs read "v1.0" cleanly. | Add APPROVED BY; align version-string convention. | no |
| MAJOR | §04 Reporting a Concern | "Contact details for the people above are in your onboarding materials" - defers to off-doc artifact. Sous retrieval will surface this as an unresolved pointer. | Either inline the contact path (Rippling People profile, Slack channel, or named role-title routing) or link to a stable doc. | yes - Kevin to confirm intended contact-routing pattern. |
| MINOR | Related Docs | SOP-004 status column reads "Referenced" not "Live / In review" - inconsistent with the other rows which carry version labels. | Use a consistent status label (Live (v1.0) / In review / Draft). | no |
| MINOR | Metadata owner | Owner = "People Operations" - department name, not role title per STD-001 §10. | Per owner-field-sweep batch: change to role-title form (e.g., "Director, People Operations"). | no |
| LEGAL-REVIEW | §01-§08 | All harassment/discrimination, single-incident-sufficiency, good-faith-report, single-state-vs-multistate language requires counsel sign-off. | Counsel review before Live. | yes - SME = Counsel. |

**Part 5 - Catalog row draft**
- card_line: "Harassment, discrimination, and retaliation are prohibited. Here's who to tell and what KitchFix does next."
- summary: "Universal KitchFix anti-harassment policy covering protected characteristics, what harassment looks like (verbal, physical, visual, electronic; including off-the-clock conduct), how and where to report (Site Leader, People Operations, Sr Dir Ops, VP Ops), the investigation process (~30-day target), anti-retaliation protection, consequences via SOP-004, and elevated manager/leadership duties to escalate rather than handle in place. Includes the club-personnel branch: route to KitchFix leadership, never to the client."
- keywords: harassment, anti-harassment, discrimination, retaliation, reporting, investigation, sexual harassment, hostile environment, protected characteristic, Site Leader, People Operations
- shelf_proposed: HR & People
- audience_proposed: operator (also corporate for manager-duties section)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - Counsel review (legal sign-off).
  - APPROVED BY metadata field.
  - Decide and inline a stable contact-routing path for §04 (or document the off-doc artifact).
  - Owner field per STD-001 §10 (role-title vs department-name) - deferred to owner-sweep batch.
  - Chunking readiness: confirm real Word heading styles in source docx (FLAT-RISK probe).

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela)
- Actual needed from Kevin: confirm the intended contact-routing path for §04 (Rippling profile? Slack? a stable internal page?) and the policy-intent for the 30-day investigation target.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: substantive content is in good shape and matches KitchFix patterns; gates to Live are counsel review, an APPROVED BY field, a stable contact path for reporting, and confirmed chunking via real heading styles.

---

### POL-008 Wage & Hour Policy

**File:** POL-008_Wage_Hour_Policy_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - 6 numbered SECTION blocks but no `[H1]`/`[H2]`/`[H3]` markers in extracted text.

**Part 1 - Identification**
- id_from_filename: POL-008
- id_in_document: POL-008 (matches)
- title_matches_tracker: yes ("Wage & Hour Policy")
- version_in_document: v1.0
- version_in_tracker: v1.0 (matches)
- metadata_finding: none.

**Part 2 - Document-level**
- A1 Accuracy: ISSUES - core facts (1.5x FLSA overtime over 40/wk; state daily-OT and meal-break variation) read correctly. The "State Annex" is named but does not exist on disk yet. Doc explicitly notes counsel completes the State Annex before Live; this is a structural-dependency issue, not a factual error.
- A2 Actionability: ISSUES - §03 timekeeping is operator-actionable ("never work off the clock"; report errors; do not edit another's time). §05 meal/rest breaks defers to State Annex with no quick-reference table - a cook in NY vs IL vs AZ cannot self-serve from this doc alone.
- A3 Completeness/Actuals: FAIL - the State Annex is referenced in §01, §04, §05 and is the load-bearing detail for daily-OT, meal-break, and rest-break compliance per state. Annex not delivered. Without it, this doc is the federal floor only; sites in CA/IL/NY/etc. need state-specific rules to operate. Also: no named pay-cycle cadence (weekly / bi-weekly), no specific Rippling-side workflow.
- A4 Format/Metadata: PASS - metadata block present with APPROVED BY: Counsel + SLT; Owner: People Operations (same owner-field note as POL-006 below). Related Docs block at end.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: FLAT-RISK - no `[H1]`/`[H2]`/`[H3]` markers; 6 SECTION blocks. Each section is short - if chunked as one blob, retrieval will be coarse but readable.
  - number_hygiene: "1.5x" overtime over 40/workweek (federal floor) is correct as stated. No date/dollar placeholders; "State Annex" is referenced as a future doc which is the right way to flag a deferred fact.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-011 (§06 Deductions & Pay Issues - "No one is retaliated against for raising a pay concern (POL-011).") - inline.
  - Related Docs: POL-007, POL-013, POL-015, POL-011, STD-001 - all labeled "Live."
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "People Operations" - same owner-field-sweep flag as POL-006.
- legal_flag: LEGAL-REVIEW required - this doc explicitly waits on counsel for the State Annex (§01 NOTE). FLSA classification edge cases and state daily-OT/meal-break rules require counsel.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | §01, §04, §05 | The State Annex this policy depends on for state daily-OT, meal-break, and rest-break rules does not exist as a referenced doc. The 8-state operating footprint (AZ, FL, IL, KY, MO, NY, OH, TX) means state-specific rules are load-bearing. NY and IL have OT/break specifics that materially differ from federal. | Build the State Annex (or 8 per-state appendices) with counsel before this goes Live. Reference it by a real Document ID (e.g. REF-NNN). | yes - counsel-built per-state rules. |
| MAJOR | Related Docs labels | Related Docs lists POL-007, POL-013, POL-015, POL-011 all as "Live." Per MANIFEST, POL-007, POL-013, POL-015, POL-011 are "In review (v1.x)" not Live. Label drift. | Update Related Docs status column to match MANIFEST. | no - just reflect MANIFEST. |
| MAJOR | §02 Pay Practices | Says "Employees are paid on the regular schedule through Rippling." No pay-cycle cadence named. Sous cannot answer "when do I get paid?" from this doc. | Name the pay cycle (weekly/bi-weekly) and pay day, or reference where the cadence lives (Rippling profile, onboarding doc). | yes - confirm KitchFix pay-cycle cadence. |
| MINOR | §03 Timekeeping | "Record meal breaks as required" - "as required" defers to State Annex; for a cook reading this in IL, the doc itself does not answer. | Once State Annex exists, link inline per state. | no - tied to Critical above. |
| MINOR | Metadata owner | Owner = "People Operations" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| LEGAL-REVIEW | All sections | FLSA exempt/non-exempt classification edge cases, daily-OT premiums, meal/rest break entitlements, and state minimum-wage rules require counsel sign-off per the §01 NOTE in-doc. | Counsel review + State Annex before Live. | yes - SME = Counsel. |

**Part 5 - Catalog row draft**
- card_line: "How KitchFix pays you - hours, overtime, breaks, timekeeping - federal floor plus state rules."
- summary: "Universal wage & hour policy stating the federal floor (FLSA 1.5x overtime over 40 in a workweek, no off-the-clock work, lawful deductions only) and pointing to a State Annex for state-specific daily-OT, minimum wage, and meal/rest break rules. Covers pay practices (paid via Rippling), timekeeping (record every hour; no editing others' time), overtime authorization, meal/rest breaks (per State Annex), deductions, and the path to report a pay discrepancy without retaliation."
- keywords: wages, overtime, FLSA, timekeeping, meal break, rest break, off the clock, paycheck, pay discrepancy, Rippling, State Annex
- shelf_proposed: HR & People
- audience_proposed: operator (heavy use by hourly)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - State Annex does not exist (CRITICAL).
  - Counsel review (legal sign-off).
  - Pay-cycle cadence not named in-doc.
  - Related Docs status labels are wrong (all 4 cross-refs labeled Live but are In Review per MANIFEST).
  - Owner field per STD-001 §10 (owner-sweep).
  - Chunking readiness: confirm real Word heading styles in source docx.

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela) + Sebastian (Accounting for pay-cycle cadence)
- Actual needed from Kevin: confirm pay-cycle cadence (weekly / bi-weekly / semi-monthly?) and whether State Annex will be a single REF doc or 8 per-state docs. Decide what the State Annex doc ID will be so the references resolve.

**Part 8 - Verdict**
- NOT-READY
- Rationale: The State Annex is load-bearing and does not exist. Policy cannot go Live in the 8-state operating footprint without state-specific rules. Counsel review also required.

---

### POL-010 EEO, Non-Discrimination & Accommodation

**File:** POL-010_EEO_Non-Discrimination_Accommodation_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - 7 numbered SECTION blocks; no `[H1]`/`[H2]`/`[H3]` markers in extracted text.

**Part 1 - Identification**
- id_from_filename: POL-010
- id_in_document: POL-010 (matches)
- title_matches_tracker: yes ("EEO, Non-Discrimination & Accommodation")
- version_in_document: v1.0
- version_in_tracker: v1.0 (matches)
- metadata_finding: none.

**Part 2 - Document-level**
- A1 Accuracy: PASS - protected categories list is standard (race, color, religion, sex, national origin, age, disability, genetic information, pregnancy, sexual orientation, gender identity, veteran/military status, "any other characteristic protected by federal, state, or local law"). Lactation accommodation called out. Counsel will confirm protected categories vary by state per the §01 NOTE in-doc.
- A2 Actionability: PASS - §06 names the path ("Start the conversation with People Operations or your manager. You do not need to use any special form or legal language - just raise the need.") - operator-actionable.
- A3 Completeness/Actuals: ISSUES - "Examples: schedule adjustments, seating, more frequent breaks, modified lifting, or a temporary change in duties" is good but is the only operational specificity. No interactive-process timeline named, no escalation if accommodation is denied (only "Report a denied accommodation through the Employee Concerns process"). Reasonable for a policy doc; flag the denied-accommodation appeal mechanism for confirmation.
- A4 Format/Metadata: PASS - metadata block has APPROVED BY: Counsel + SLT; Owner: People Operations.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: no problem figures.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-006 (§03 NOTE - "governed in detail by POL-006 Anti-Harassment Policy") - inline.
  - POL-001 (§07 - "Employee Concerns process (POL-001)") - inline.
  - POL-011 (§07 - retaliation protection) - inline.
  - Related Docs: POL-006, POL-001, POL-011, PB-004, STD-001.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "People Operations" - owner-field-sweep note.
- legal_flag: LEGAL-REVIEW required - protected categories vary by state and locality per the §01 NOTE in-doc. Pregnancy accommodation (PWFA), lactation (PUMP Act), religious accommodation, and disability (ADA) interactive-process requirements need counsel sign-off.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Related Docs labels | Related Docs lists POL-006 "In review," POL-001 "In review," POL-011 "Draft," PB-004 "In review," STD-001 "Live (v1.1)." Per MANIFEST, POL-011 is "In review (v1.0)" not "Draft." Status drift. | Update Related Docs status column to match MANIFEST. | no |
| MINOR | §06 Requesting an Accommodation | Says "People Operations works with you (and your healthcare provider where relevant) to find a workable accommodation" - no SLA / process timeline given. ADA interactive-process expectations include reasonable timeliness. | Either add a target timeline (e.g., "begins within X business days of request") or leave to counsel-driven State Annex. | yes - Kevin to confirm intended SLA. |
| MINOR | §07 Reporting & No Retaliation | "Report discrimination, harassment, or a denied accommodation" - no mention of what to do if Employee Concerns (POL-001) leads to no resolution. | If there is an escalation beyond POL-001 (counsel? Sr Dir Ops?), name it. | yes - confirm denied-accommodation escalation path. |
| MINOR | Metadata owner | Owner = "People Operations" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| LEGAL-REVIEW | §02, §04, §05 | Protected categories list, pregnancy/lactation accommodation specifics (PWFA, PUMP Act), and ADA interactive-process language require counsel sign-off. State-specific protected classes vary. | Counsel review before Live. | yes - SME = Counsel. |

**Part 5 - Catalog row draft**
- card_line: "Equal opportunity at KitchFix. Need an accommodation? Start the conversation with People Operations or your manager."
- summary: "KitchFix's equal-opportunity policy covering protected characteristics (federal floor; state-specific additions handled in the State Annex), non-discrimination commitments across hiring through termination, reasonable accommodation for disability and religion, pregnancy and lactation accommodation, the request path (People Ops, no special form required), and protection from retaliation under POL-011. Harassment specifically is governed by POL-006."
- keywords: EEO, equal opportunity, discrimination, accommodation, disability, ADA, religious accommodation, pregnancy, lactation, interactive process, People Operations
- shelf_proposed: HR & People
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - Counsel review (legal sign-off).
  - Related Docs status labels (POL-011 listed as "Draft," per MANIFEST it is "In review").
  - Owner field per STD-001 §10 (owner-sweep).
  - Confirm accommodation-request SLA (optional - may live in counsel-driven detail).
  - Chunking readiness: confirm real Word heading styles in source docx.

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela)
- Actual needed from Kevin: confirm accommodation-request SLA expectations and the denied-accommodation escalation path beyond POL-001.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: clean policy structure, no factual issues, ready once counsel signs off, Related Docs labels are corrected, and chunking is verified.

---

### POL-011 Anti-Retaliation / Whistleblower

**File:** POL-011_Anti-Retaliation_Whistleblower_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - 6 numbered SECTION blocks; no heading markers.

**Part 1 - Identification**
- id_from_filename: POL-011
- id_in_document: POL-011 (matches)
- title_matches_tracker: yes ("Anti-Retaliation / Whistleblower")
- version_in_document: v1.0
- version_in_tracker: v1.0 (matches)
- metadata_finding: none.

**Part 2 - Document-level**
- A1 Accuracy: PASS - good-faith protection, protected-activity list (harassment/discrimination, safety/food-safety, illegal conduct, accommodation requests, exercising legal rights), retaliation-as-violation, manager-included. Standard anti-retaliation structure.
- A2 Actionability: PASS - §05 names the routing (People Ops, Sr Dir Ops, VP Ops; route around the one involved). §06 routes to SOP-004 for consequences.
- A3 Completeness/Actuals: PASS - clean and short. No actuals missing for a policy at this altitude.
- A4 Format/Metadata: PASS - metadata block has APPROVED BY: Counsel + SLT.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: no problem figures.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-001 (§05 - "Employee Concerns process (POL-001)") - inline.
  - SOP-004 (§06 - "Substantiated retaliation results in discipline up to termination (SOP-004).") - inline.
  - Related Docs: SOP-002, POL-001, POL-006, POL-010, SOP-004, STD-001.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "People Operations" - owner-field-sweep note.
- legal_flag: LEGAL-REVIEW required - whistleblower-protection language (federal: OSHA, Sarbanes-Oxley equivalents not applicable; state: varies materially) and good-faith-report doctrine need counsel sign-off. Audit Brief / MANIFEST already flag "Counsel review required."

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Related Docs labels | All 6 Related Docs rows labeled "Live." Per MANIFEST: POL-001 In review (v1.0), POL-006 In review (v1.0), POL-010 In review (v1.0), SOP-004 In review (v1.0). Only SOP-002 and STD-001 are actually Live. Status drift. | Update Related Docs status column to match MANIFEST. | no |
| MINOR | Metadata owner | Owner = "People Operations" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| MINOR | §05 How to Report | "If one of those people is involved, report to another of them" - operator-actionable, but does not name an external whistleblower-hotline path (some companies provide one; KitchFix may not). | Confirm whether KitchFix maintains an external reporting channel (ethics hotline, anonymous channel). If not, state explicitly. | yes - Kevin to confirm external-hotline policy. |
| LEGAL-REVIEW | §03 Protected Activity, §04 What Retaliation Looks Like, §06 | Whistleblower-protection scope and state-specific retaliation statutes need counsel sign-off. | Counsel review before Live. | yes - SME = Counsel. |

**Part 5 - Catalog row draft**
- card_line: "Speak up in good faith and you are protected. Retaliation is itself a violation, including against managers."
- summary: "KitchFix anti-retaliation and whistleblower policy: prohibits retaliation against any employee for protected activity (reporting harassment/discrimination, safety/food-safety concerns, suspected illegal conduct, fraud, policy violations; cooperating with investigations; requesting accommodation; exercising leave/wage/safety rights). Defines what retaliation looks like (termination, hour cuts, shift changes, exclusion, hostile treatment). Routes reports to People Ops, Sr Dir Ops, or VP Ops; substantiated retaliation gets SOP-004 discipline."
- keywords: retaliation, whistleblower, protected activity, good faith, reporting, investigation, manager retaliation, hour cut, shift change, accommodation request
- shelf_proposed: HR & People
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - Counsel review (legal sign-off).
  - Related Docs status labels (4 of 6 wrong).
  - Confirm external whistleblower-hotline policy or state its absence.
  - Owner field per STD-001 §10 (owner-sweep).
  - Chunking readiness: confirm real Word heading styles.

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela)
- Actual needed from Kevin: confirm whether KitchFix maintains an external/anonymous whistleblower channel.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: short, clean policy; ready once counsel signs off and the Related Docs labels are corrected.

---

### POL-013 Employee Classification & Seasonal Workforce

**File:** POL-013_Employee_Classification_Seasonal_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - 5 numbered SECTION blocks; no heading markers.

**Part 1 - Identification**
- id_from_filename: POL-013
- id_in_document: POL-013 (matches)
- title_matches_tracker: yes ("Employee Classification & Seasonal Workforce")
- version_in_document: v1.0
- version_in_tracker: v1.0 (matches)
- metadata_finding: none.

**Part 2 - Document-level**
- A1 Accuracy: PASS - FLSA non-exempt/exempt definitions; full-time = 30+ hrs/wk; part-time = <30 hrs/wk; seasonal and temporary. Contractor language ("when the relationship genuinely meets that standard") is the standard FLSA economic-realities posture.
- A2 Actionability: ISSUES - this is more conceptual than action-oriented. §05 routes classification questions to People Operations - good. No worked examples for how a Task Force chef vs an Executive Chef gets classified.
- A3 Completeness/Actuals: ISSUES - §03 Seasonal references "spring training, regular season, and the affiliate calendar" - aligns with KitchFix's MLB/MiLB context. "Rehire and returning-staff practices are defined so the company keeps proven people season to season" - the practices themselves are not defined here. Where are they? §04 names "Task Force and Corporate Field Chefs" - flag whether these are exhaustive contractor categories.
- A4 Format/Metadata: PASS - metadata block has APPROVED BY: Counsel + SLT.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: "50 to 300" workforce range in §01 - this is a real claim Sous might quote. Confirm 50 / 300 is the policy-intent ceiling.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-007 (§05 - "see POL-007, POL-008") - inline.
  - POL-008 (§05) - inline.
  - POL-015 (§05 - "see POL-015") - inline.
  - Related Docs: PB-004, POL-007, POL-008, POL-015, STD-001.
- inbound_retired_pointer: NO
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "People Operations" - owner-field-sweep note.
  - MINOR: §03 says "Rehire and returning-staff practices are defined" but does not point to the doc that defines them - either point to SOP-005 (Onboarding - if rehire is covered there) or to a TBD doc.
- legal_flag: LEGAL-REVIEW required - FLSA exempt/non-exempt classification is litigation-prone. Independent-contractor classification (Task Force / Corporate Field Chefs) is legally sensitive. Audit Brief / MANIFEST flag "Counsel + FLSA."

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Related Docs labels | All 5 Related Docs rows labeled "Live." Per MANIFEST: PB-004 In review (v1.2), POL-007 In review (v1.1), POL-008 In review (v1.0), POL-015 In review (v1.0). Only STD-001 is Live. Status drift. | Update Related Docs status column to match MANIFEST. | no |
| MAJOR | §03 Seasonal Workforce | "Rehire and returning-staff practices are defined so the company keeps proven people season to season" - the practices are referenced but not pointed to a defining doc. Operator cannot find the actual rehire SOP. | Either link to SOP-005 (Onboarding) if rehire lives there, or open a GAP marker for a future Rehire SOP. | yes - Kevin to confirm where rehire-practice doc lives. |
| MAJOR | §04 Contractors & Task Force | Names "Task Force and Corporate Field Chefs" as contractor categories. No definition of which roles map to which category, no MSAs/agreements referenced, no role-based criteria for the classification call. | Either list the criteria or point to a contractor-mgmt doc / template. | yes - Kevin / Sebastian to confirm contractor classification framework. |
| MINOR | §01 workforce range | "Roughly 50 to 300" - confirm policy-intent boundary; Sous may quote this as authoritative range. | Confirm or generalize ("multiple sites, scales with the baseball season"). | yes - confirm numeric range. |
| MINOR | Metadata owner | Owner = "People Operations" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| LEGAL-REVIEW | §02, §04 | FLSA classification (exempt/non-exempt salary-and-duties test) and independent-contractor classification (Task Force) require counsel sign-off. State rules vary (CA ABC test, etc.). | Counsel review before Live. | yes - SME = Counsel + Sebastian. |

**Part 5 - Catalog row draft**
- card_line: "How KitchFix classifies you - non-exempt vs exempt, full-time vs part-time, seasonal, or contractor - and why it matters for pay, OT, and benefits."
- summary: "KitchFix employee-classification policy covering FLSA non-exempt vs exempt (verified per role; not assumed by title), employment status (full-time 30+ hrs/wk; part-time <30; seasonal; temporary), the seasonal workforce that scales roughly 50 to 300 with the baseball calendar, and independent-contractor status for Task Force / Corporate Field Chefs (classified by actual working relationship, not label)."
- keywords: classification, exempt, non-exempt, FLSA, full-time, part-time, seasonal, temporary, contractor, Task Force, Corporate Field Chefs, benefits eligibility
- shelf_proposed: HR & People
- audience_proposed: corporate + operator (for self-understanding)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - Counsel review (legal sign-off).
  - Related Docs status labels (4 of 5 wrong).
  - Resolve where rehire / returning-staff practice is defined.
  - Confirm contractor classification framework (Task Force vs Corp Field Chef).
  - Owner field per STD-001 §10 (owner-sweep).
  - Chunking readiness: confirm real Word heading styles.

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela) + Sebastian (Accounting for contractor framework)
- Actual needed from Kevin: confirm where the rehire practice is defined; confirm contractor classification framework.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: structurally clean; gates are counsel review, two unresolved cross-doc dependencies (rehire practice; contractor framework), and Related Docs labels.

---

### POL-014 Code of Conduct & Ethics

**File:** POL-014_Code_of_Conduct_Ethics_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - 7 numbered SECTION blocks; no heading markers.

**Part 1 - Identification**
- id_from_filename: POL-014
- id_in_document: POL-014 (matches)
- title_matches_tracker: yes ("Code of Conduct & Ethics")
- version_in_document: v1.0
- version_in_tracker: v1.0 (matches)
- metadata_finding: none.

**Part 2 - Document-level**
- A1 Accuracy: PASS - five standards (Respect, Integrity, Professionalism, Safety, Accountability) align with AGR-001 Big Rules theming. Brand promise "Best Food, Best Service, Best Hospitality" not present here but partially echoed ("how we carry ourselves is the brand"); not flagged because it is implicit in §01.
- A2 Actionability: PASS - §03 conflict examples (outside work that competes; financial interest in vendor; hiring/supervising close family; using position for personal gain). §06 names the MLB-specific risks (banned substances, gambling).
- A3 Completeness/Actuals: ISSUES - §06 says "Modest, customary courtesies are acceptable" with no dollar threshold. Standard codes name a threshold ("$50/year aggregate" or similar). §06 references "SOP-009" for banned substances - SOP-009 NSF Certified-for-Sport is "Not started (—)" per MANIFEST and tagged MUST-HAVE-but-unauthored. This is a forward reference to a doc that does not exist yet.
- A4 Format/Metadata: PASS - metadata block has APPROVED BY: Counsel + SLT.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: no figures; flag the no-dollar-threshold issue under findings.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-006 (§02 - "see POL-006, POL-010") - inline.
  - POL-010 (§02) - inline.
  - POL-009 (§05 - "Technology use follows POL-009 IT & Acceptable Use.") - inline.
  - SOP-009 (§06 - "anything touching banned substances (see SOP-009)") - **inline reference to a doc that does not yet exist** (per MANIFEST: SOP-009 Not started).
  - POL-011 (§07 - "Reporting in good faith is protected - no retaliation (POL-011)") - inline.
  - POL-001 (§07 - "Employee Concerns process (POL-001)") - inline.
  - SOP-004 (§07 - "Formal Disciplinary Process (SOP-004)") - inline.
  - AGR-001 (§01 - "It works alongside AGR-001 The Big Rules") - inline. **Counsel and the Audit Brief specifically note POL-014 should pair with AGR-001 - this anchor is present, good.**
  - Related Docs: AGR-001, POL-001, POL-006, POL-011, SOP-004, STD-001.
- inbound_retired_pointer: NO (SOP-009 is "Not started," not retired; but it is also load-bearing and unauthored which is its own concern - see Findings).
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "People Operations" - owner-field-sweep note.
- legal_flag: LEGAL-REVIEW required - Code of Conduct content (gifts policy, conflict-of-interest, confidentiality continuing post-employment, social-media restrictions, MLB-specific rules) needs counsel sign-off.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | §06 Gifts, Clients & MLB | Inline reference to SOP-009 (NSF Certified-for-Sport) for banned-substances scope - SOP-009 is "Not started" per MANIFEST and is a MUST-HAVE-but-unauthored doc. This Code therefore points at a Document ID that does not resolve to content. | Either build a stub for SOP-009 with at least scope and current MLB banned-substances pointer (UFC PED list or MLB equivalent), or fold the banned-substances rule directly into POL-014 §06 until SOP-009 exists. | yes - confirm intended treatment until SOP-009 is authored. |
| MAJOR | §06 Gifts | "Modest, customary courtesies are acceptable; anything that could look like influence is not." No dollar threshold or aggregate limit. Most codes name a threshold for clarity. | Either add a threshold (counsel-confirmed) or state explicitly "no dollar threshold; ask if unsure" as the policy. | yes - Kevin to confirm threshold posture. |
| MAJOR | Related Docs labels | Related Docs row labels: AGR-001 "Live (v1.1)" (matches MANIFEST), POL-001 "In review," POL-006 "In review," POL-011 "Draft," SOP-004 "In review," STD-001 "Live (v1.1)." Per MANIFEST: POL-011 is "In review (v1.0)" not "Draft." | Correct POL-011 status label. | no |
| MINOR | §04 Confidentiality | "Confidentiality continues after employment ends." This is a substantive contractual statement. Confirm this is in employment agreements / handbooks, not just here. | If POL-014 is the SOLE place, counsel should make sure it is enforceable; if it duplicates AGR-001 / employment agreement, point there. | yes - confirm intended source-of-truth for post-employment confidentiality. |
| MINOR | Metadata owner | Owner = "People Operations" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| LEGAL-REVIEW | §03, §04, §06 | Conflicts-of-interest, confidentiality continuing post-employment, gifts policy, MLB league-rule-specific clauses require counsel sign-off. | Counsel review before Live. | yes - SME = Counsel. |

**Part 5 - Catalog row draft**
- card_line: "How every KitchFix employee carries themselves - integrity, respect, professionalism, safety, accountability - on every shift in a client's house."
- summary: "KitchFix's Code of Conduct & Ethics, paired with AGR-001 The Big Rules. Sets five behavioral standards (Respect, Integrity, Professionalism, Safety, Accountability), covers conflicts of interest (disclose to manager or People Ops), confidentiality (player health/dietary info strictly confidential; no clubhouse posts on social media; confidentiality continues after employment), company property and systems (technology use per POL-009), gifts and MLB-environment expectations (no solicited gifts; no league-rule violations including banned substances and gambling), and the reporting path (manager, People Ops, or POL-001; consequences via SOP-004; retaliation protected by POL-011)."
- keywords: code of conduct, ethics, integrity, professionalism, conflicts of interest, confidentiality, gifts, social media, MLB rules, banned substances, gambling
- shelf_proposed: HR & People
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - Counsel review (legal sign-off).
  - SOP-009 reference resolution (either build SOP-009 stub or fold banned-substances inline).
  - Gifts-threshold decision.
  - Confirm post-employment confidentiality source-of-truth.
  - Related Docs status label (POL-011).
  - Owner field per STD-001 §10 (owner-sweep).
  - Chunking readiness: confirm real Word heading styles.

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela) + Josh/Joe (for MLB-environment policy intent)
- Actual needed from Kevin: confirm gifts-threshold posture; confirm where SOP-009 reference resolves (stub vs fold-in); confirm post-employment confidentiality source-of-truth.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: substantively complete; pairs correctly with AGR-001; gates are counsel review, SOP-009 reference resolution, gifts-threshold decision, and Related Docs labels.

---

### POL-015 Leave Policies

**File:** POL-015_Leave_Policies_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: People Operations
**Structure verdict (chunking probe):** FLAT-RISK - 8 numbered SECTION blocks; no heading markers.

**Part 1 - Identification**
- id_from_filename: POL-015
- id_in_document: POL-015 (matches)
- title_matches_tracker: yes ("Leave Policies")
- version_in_document: v1.0
- version_in_tracker: v1.0 (matches)
- metadata_finding: none.

**Part 2 - Document-level**
- A1 Accuracy: PASS - FMLA structure (50 employees within 75 miles, 12 months / 1,250 hours eligibility, 12 weeks / 26 weeks military caregiver) is canonical. Paid sick floor (1 hr per 30 worked, 40/yr cap) matches the load-bearing-doc statement in RUBRIC_PACK §4. Anti-retaliation for use of sick leave (CRITICAL callout in §04) is correct.
- A2 Actionability: PASS - §06 routes leave requests through People Operations; 30-day advance for foreseeable FMLA; documentation required only for absences over 3 consecutive days where law allows.
- A3 Completeness/Actuals: ISSUES - "Bereavement - time off following the death of a family member" - no duration named (typical is 3-5 days; varies). "Personal / medical (non-FMLA) - unpaid leave considered case by case" - no max duration. State Annex carries binding detail for other leaves but the company-policy floor is thin. Once the State Annex exists, this becomes a non-issue per the floor-then-override convention.
- A4 Format/Metadata: PASS - metadata block has APPROVED BY: Counsel + SLT.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: "12 months / 1,250 hours / 50 employees within 75 miles" (FMLA standard - correct as cited). "1 hour per 30 hours worked, up to 40 hours used per year" - matches RUBRIC §4 load-bearing fact. No problem figures.

**Part 3 - Library checks**
- cross_refs_in_text:
  - POL-011 (§04 - "It is protected activity (POL-011)") - inline.
  - POL-011 (§06 - retaliation protection) - inline.
  - POL-010 (§08 - "accommodation conversation (POL-010)") - inline.
  - Related Docs: POL-004, POL-010, POL-011, POL-013, STD-001.
- inbound_retired_pointer: NO. **Important: per Audit Brief, POL-015 consolidates retired POL-017 and POL-018. This doc does NOT cross-reference POL-017 or POL-018 anywhere - correct behavior per brief.**
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "People Operations" - owner-field-sweep note.
- legal_flag: LEGAL-REVIEW required - FMLA worksite determination for KitchFix's seasonal/multi-site footprint (called out in-doc as CRITICAL in §03); state-specific paid sick leave laws and other state leaves require counsel sign-off and the State Annex.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | §03 FMLA | Doc explicitly flags CRITICAL: FMLA worksite-by-worksite coverage determination required, but the per-worksite determination has not been done. KitchFix's seasonal/multi-site footprint means some sites likely cross the 50-within-75-miles threshold during peak season; others do not. Sites cannot self-determine FMLA coverage from this doc. | Counsel + HR build the per-worksite FMLA-coverage table as part of the State Annex (or as a parallel REF doc). | yes - SME = Counsel + HR. |
| MAJOR | Related Docs labels | All 5 Related Docs rows labeled "Live." Per MANIFEST: POL-004 In review (v1.0), POL-010 In review (v1.0), POL-011 In review (v1.0), POL-013 In review (v1.0). Only STD-001 is Live. Status drift. | Update Related Docs status column to match MANIFEST. | no |
| MAJOR | §05 Other Leaves | Bereavement, Personal/medical, Jury, Military, Voting, Safe leave - no durations named for company-policy floor. State Annex covers state-mandated durations but the company floor is undefined for bereavement and personal/medical. | Either set a company floor (e.g., "3 days bereavement for immediate family") or state explicitly that all durations defer to State Annex / case-by-case. | yes - Kevin/Mariela to confirm bereavement and personal/medical company floor. |
| MAJOR | State Annex | Same dependency as POL-008: the State Annex referenced in §01 NOTE, §04, §07 does not exist on disk yet. Without it, this doc is the federal floor plus the company-wide paid-sick standard - operators in NY/CA/IL cannot self-serve fully. | Build State Annex with counsel (likely shared with POL-008). | yes - SME = Counsel. |
| MINOR | §04 Paid Sick Leave | "Carryover follows the governing law" - operator-friendly statement, but for sites in no-law states the company floor on carryover is undefined. | Either set a default (e.g., "no carryover beyond annual cap") or state "carryover only where state law requires." | yes - confirm company carryover floor. |
| MINOR | Metadata owner | Owner = "People Operations" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| LEGAL-REVIEW | All sections | FMLA worksite determination, state paid-sick-leave specifics, state pregnancy/parental/safe-leave laws, USERRA application, and jury-duty pay vs unpaid all require counsel sign-off. | Counsel review + State Annex + per-worksite FMLA table before Live. | yes - SME = Counsel. |

**Part 5 - Catalog row draft**
- card_line: "Every leave KitchFix offers in one place - FMLA, paid sick leave, and the others. Request through People Operations."
- summary: "Consolidated KitchFix leave policy (replaces the separate FMLA and Paid Sick Leave policies). Covers FMLA eligibility (12 mo / 1,250 hrs / 50 employees within 75 miles, with KitchFix's seasonal multi-site footprint requiring counsel to confirm coverage worksite-by-worksite), up to 12 weeks (26 weeks for military caregiver). KitchFix's company-wide paid sick standard: 1 hour per 30 hours worked, up to 40 hours used per year, in every state. Other leaves (personal/medical, jury, bereavement, military/USERRA, voting, safe leave) per state law. Request through People Operations; protected against retaliation under POL-011."
- keywords: leave, FMLA, paid sick leave, sick time, bereavement, jury duty, military leave, USERRA, voting leave, safe leave, accommodation, People Operations
- shelf_proposed: HR & People
- audience_proposed: operator + corporate
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - Counsel review (legal sign-off).
  - State Annex (shared with POL-008).
  - Per-worksite FMLA-coverage determination.
  - Other-leaves company floors (bereavement, personal/medical).
  - Sick-leave carryover company floor.
  - Related Docs status labels.
  - Owner field per STD-001 §10 (owner-sweep).
  - Chunking readiness: confirm real Word heading styles.

**Part 7 - SME/actuals**
- SME: Counsel + HR (Mariela)
- Actual needed from Kevin: confirm bereavement and personal-leave company floor; confirm sick-leave carryover company floor.

**Part 8 - Verdict**
- NOT-READY
- Rationale: The State Annex and per-worksite FMLA-coverage determination are load-bearing and do not exist. Doc explicitly flags the FMLA worksite issue as CRITICAL within the body, which is correct - but until that table exists, sites cannot use this policy to determine FMLA coverage.

---

### POL-019 Permit & License Compliance Policy

**File:** POL-019_Permit_License_Compliance_Policy_v1_0.txt
**Tracker status / version:** In review (v1.0), Owner: Finance
**Structure verdict (chunking probe):** FLAT-RISK - 6 numbered SECTION blocks; no heading markers.

**Part 1 - Identification**
- id_from_filename: POL-019
- id_in_document: POL-019 (matches)
- title_matches_tracker: yes ("Permit & License Compliance Policy")
- version_in_document: "v1.0" (note trailing space on the line, harmless)
- version_in_tracker: v1.0 (matches)
- metadata_finding: MINOR - APPROVED BY reads "SLT" only, while every other Batch A POL reads "Counsel + SLT." Permit/license compliance is regulatory by nature; consider counsel review even if approval body is SLT alone. (See legal_flag.)

**Part 2 - Document-level**
- A1 Accuracy: PASS - permit/license categories (business license, food service permit, health permit, fire/occupancy, hood suppression, weights & measures) are reasonable starting list. No food-safety temps. No regulatory facts to validate beyond the renewal-before-expiration principle.
- A2 Actionability: ISSUES - §03 names roles cleanly (Finance owns register; EC/Site Leadership posts and surfaces; Sr Dir Ops escalates). §04 is a placeholder: "The specific requirements by site and jurisdiction are being compiled with Finance and will be added here." This is the load-bearing detail of the policy and it is explicitly missing. Operator cannot self-serve "what permit does my site need?"
- A3 Completeness/Actuals: FAIL - §04 is a placeholder. §05 says "The register and renewal-tracking tool - spreadsheet or intranet table - will be specified once Finance finalizes the register" - the register tool is undefined. The two load-bearing actuals (per-site permit list; register tool) are missing.
- A4 Format/Metadata: ISSUES - metadata block lacks "Counsel" approval (just "SLT"); inconsistent with the other 7 Batch A POLs. Owner field reads "Finance" (department name) - same STD-001 §10 owner-as-role-title note.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: medium - §04 is an explicit placeholder with NOTE "This section is a placeholder." Sous will retrieve this as if it is the policy. The doc itself flags it as a placeholder, which is correct in print but a risk in retrieval - Sous may quote the non-exhaustive permit list as authoritative.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: "60 days before expiration" for renewal kickoff (§05) - this is a real policy commitment Sous may quote. Confirm 60-day target.

**Part 3 - Library checks**
- cross_refs_in_text:
  - Related Docs: PB-007, SOP-008, CHK-003, STD-001 - all labeled "Live."
  - No inline document-ID references in body.
- inbound_retired_pointer: NO. **Important: POL-019 supersedes REF-008 (Permit & License Tracker) per MANIFEST retired set. POL-019 does NOT reference REF-008 anywhere - correct.**
- contradiction_within_doc: none
- terminology_drift:
  - MINOR: Owner = "Finance" - department name. Per STD-001 §10 owner should be role title (e.g., "Director of Finance" or "Sebastian Lopez" - but personal names are not allowed per STD-001 §10). Owner-field-sweep note.
  - MINOR: §03 uses "Executive Chef / Site Leadership" - matches PB-001 / SOP-002 site-triad language. Good.
- legal_flag: LEGAL-REVIEW recommended - permit/license compliance is regulatory and per-jurisdiction. APPROVED BY reads "SLT" without counsel - flagging because regulatory exposure is real.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | §04 Required Permits & Licenses | This section is the load-bearing detail of the policy and is an explicit placeholder ("The specific requirements by site and jurisdiction are being compiled with Finance and will be added here"). Operator cannot self-serve "what permit does my site need?" without the per-site list. Doc cannot go Live in this state because the register IS the policy. | Finance compiles the per-site / per-jurisdiction permit register; reference it by Document ID (REF-NNN) so cross-references resolve. | yes - SME = Finance (Sebastian). |
| CRITICAL | §05 register tool | "The register and renewal-tracking tool - spreadsheet or intranet table - will be specified once Finance finalizes the register." The register tool is the operational mechanism and is undefined. Without it the policy is unenforceable. | Finance specifies the tool (sheet, intranet table, or third-party tool). | yes - SME = Finance. |
| MAJOR | Metadata APPROVED BY | Reads "SLT" only; every other Batch A POL reads "Counsel + SLT." Permit/license is regulatory; counsel review is recommended even if not required. | Confirm counsel posture; if counsel reviewed, add to APPROVED BY. | yes - confirm counsel involvement. |
| MAJOR | §05 60-day renewal kickoff | "Renewals begin at least 60 days before expiration." This is a real policy commitment. Confirm 60 days is the intended floor (some permits, e.g., hood suppression cert, may require longer lead time). | Confirm 60-day floor or state per-permit lead time. | yes - confirm 60-day floor. |
| MINOR | Metadata owner | Owner = "Finance" - department name not role title per STD-001 §10. | Per owner-field-sweep batch. | no |
| MINOR | Related Docs labels | Related Docs lists PB-007 "Live," SOP-008 "Live," CHK-003 "Live," STD-001 "Live." Per MANIFEST: PB-007 In review (v1.0), SOP-008 In review (v1.0), CHK-003 In review (v1.0), only STD-001 is Live. Status drift. | Update Related Docs status column. | no |
| LEGAL-REVIEW | Whole doc | Regulatory exposure; per-jurisdiction requirements. APPROVED BY currently lacks Counsel. | Counsel review of policy + register. | yes - SME = Counsel + Finance. |

**Part 5 - Catalog row draft**
- card_line: "Every KitchFix site holds the permits and licenses it needs - current, renewed early, posted on site. Finance owns the register."
- summary: "KitchFix policy that every site operates only with the permits and licenses required by its jurisdiction. Finance owns the central register and the renewal process; Executive Chef / Site Leadership posts current permits, surfaces local requirements, and flags expirations; Sr Dir Ops is the escalation point. Renewals begin at least 60 days before expiration. Required permits are compiled by Finance per site / jurisdiction (placeholder list includes business license, food service permit, health permit, fire/occupancy, hood suppression, weights & measures). A lapsed or missing required permit is a serious compliance issue and triggers escalated review."
- keywords: permit, license, compliance, renewal, expiration, register, food service permit, health permit, fire occupancy, hood suppression, weights and measures, jurisdiction
- shelf_proposed: Site & Client (regulatory / per-site compliance; arguably Operations)
- audience_proposed: corporate (Finance + Sr Dir Ops) + operator (EC for posting)
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- Blocks to Live:
  - §04 per-site permit register (CRITICAL).
  - §05 register tool specification (CRITICAL).
  - APPROVED BY counsel addition (recommended).
  - 60-day renewal kickoff confirmation.
  - Related Docs status labels.
  - Owner field per STD-001 §10 (owner-sweep).
  - Chunking readiness: confirm real Word heading styles.

**Part 7 - SME/actuals**
- SME: Finance (Sebastian) + Counsel
- Actual needed from Kevin: Finance has to compile the per-site / per-jurisdiction permit register. Decide register tool (sheet vs intranet table). Confirm 60-day renewal floor.

**Part 8 - Verdict**
- NOT-READY
- Rationale: §04 (per-site permit list) and §05 (register tool) are explicit placeholders - the policy IS the register, and the register does not exist. POL-019 inherits this gap from the retired REF-008 (Permit & License Tracker). Cannot go Live until Finance compiles the register.

---

## Cross-batch observations

**1. Owner-field convention is consistent within Batch A but department-name-not-role-title across the board.**
All 8 docs use a department name as the owner field ("People Operations" x7, "Finance" x1). Per STD-001 §10, owner should be a role title. This matches the existing owner-field-sweep tracking in `MEMORY.md > project_opd_owner_field_sweep` - those 11 docs are already deferred to a per-doc batch. All 8 Batch A POLs should be added to that sweep.

**2. Related Docs status-label drift is systemic across the batch.**
Every POL in the batch except POL-006 mislabels at least 2 Related Docs as "Live" when MANIFEST shows them as "In review." This is a library-wide hygiene issue and probably a single pass to reconcile:
- POL-008: 4 of 5 cross-refs mislabeled "Live"
- POL-010: 1 mislabeled (POL-011 "Draft" should be "In review")
- POL-011: 4 of 6 mislabeled "Live"
- POL-013: 4 of 5 mislabeled "Live"
- POL-014: 1 mislabeled (POL-011 "Draft" should be "In review")
- POL-015: 4 of 5 mislabeled "Live"
- POL-019: 3 of 4 mislabeled "Live"

The pattern: drafters anticipated these would be Live by the time POL-015 / etc. went Live, and pre-labeled accordingly. Fix: a single status-label reconciliation pass once Live status is set per doc.

**3. State Annex is referenced by multiple docs but does not exist.**
POL-008 and POL-015 both reference a "State Annex" as load-bearing detail (daily-OT, meal/rest breaks, paid sick law specifics, other-leave specifics). The State Annex is referred to as a named-but-undelivered artifact. Decision needed: is "State Annex" a single doc, 8 per-state appendices, or one REF doc per state? POL-008 and POL-015 should reference it by a real Document ID once defined.

**4. Metadata "APPROVED BY" is inconsistent.**
- POL-006: no APPROVED BY field at all.
- POL-008, POL-010, POL-011, POL-013, POL-014, POL-015: "Counsel + SLT"
- POL-019: "SLT" only (no counsel).

Two outliers: POL-006 missing the field entirely; POL-019 missing counsel.

**5. Version-string convention is inconsistent.**
- POL-006: "v1.0 · Draft" (with the "Draft" suffix)
- POL-008-019: "v1.0" (clean)

POL-006 should be aligned to the clean form, or the convention should formally allow the "Draft" suffix.

**6. POL-014's reference to SOP-009 is a problem.**
SOP-009 NSF Certified-for-Sport is "Not started (—)" per MANIFEST and tagged MUST-HAVE-but-unauthored. POL-014 §06 references it for banned-substances rule. This is a forward reference to a doc that does not exist yet - the only such forward reference in the batch.

**7. No retired-set inbound pointers in the batch - good.**
None of the 8 POLs reference POL-005, POL-012, POL-016, POL-017, POL-018, SOP-003, SOP-011, SOP-013, SOP-016, REF-008, REF-009, LEGACY-PR, LEGACY-WOW, LEGACY-PFS-CONF, or TPL-017. POL-015 correctly consolidates the retired POL-017 + POL-018 content without pointing back at them. POL-019 correctly supersedes the retired REF-008 without pointing back.

**8. Brand promise / terminology drift - no major issues.**
- Brand promise "Best Food, Best Service, Best Hospitality" appears verbatim in POL-006 §01 ANCHOR - good.
- POL-006 names "Mariela Chavez, People Operations Generalist" - real person, real role - good.
- No "Galley" references in any of the 8 POLs - good.
- POL-019 §03 uses "Executive Chef / Site Leadership" - aligns with site-triad language.

**9. Counsel-review gate.**
All 8 docs require counsel review before Live. POL-006 lacks the APPROVED BY field; POL-019 lacks counsel in its APPROVED BY field; the other 6 have "Counsel + SLT" in place. This is the load-bearing gate to Live for the entire batch.

**10. FLAT-RISK chunking across the batch.**
All 8 docs are FLAT-RISK per MANIFEST. The extracted text shows numbered SECTION blocks but no `[H1]`/`[H2]`/`[H3]` markers - meaning the source docx likely uses bold-text styling rather than Word Heading 1/2/3 styles. Without real heading styles each doc will chunk as a single blob for Sous retrieval. Fix is mechanical: apply Word heading styles to the SECTION/sub-section structure already present.

**11. Two NOT-READY verdicts in the batch:**
- POL-008 (State Annex does not exist)
- POL-015 (State Annex does not exist; per-worksite FMLA coverage table does not exist)
- POL-019 (per-site permit register and register tool do not exist)

The other 5 (POL-006, POL-010, POL-011, POL-013, POL-014) are READY-PENDING-SME, gated on counsel sign-off plus per-doc minor fixes.

**12. POL-019 verdict-versus-shelf note.**
POL-019 sits awkwardly in shelf taxonomy: it is universally-applicable (people in scope: everyone who operates a site) but the actual content is regulatory/operational, not HR. Proposed shelf "Site & Client" reflects the operational nature; "HR & People" would also be defensible. Flag for taxonomy decision in CK-3.
