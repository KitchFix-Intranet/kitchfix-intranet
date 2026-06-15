# OPD Audit Pass 1 - Scorecards Batch D (PB cluster, 8 docs)

Scored: 2026-06-14. Read-only. Hyphens only in this output.

Docs in batch:
- PB-004 Hourly Employee Handbook v1.2
- PB-007 Workplace Safety Manual v1.0
- PB-008 Emergency Prep & Continuity v1.0
- PB-009 Financial Operations Manual v1.0
- PB-010 Site Operations Manual v1.0 (non-dup)
- PB-010 (1) Site Operations Manual v1.0 (duplicate; diffed below)
- PB-012 Client & Account Management Playbook v1.0
- PB-013 Training & Certification Program v1.0

---

### PB-004 Hourly Employee Handbook v1.2

**File:** PB-004_Hourly_Employee_Handbook_v1.2.txt
**Tracker status / version:** In review (v1.2) - HR (note: owner sweep flag - "Human Resources" used per STD-001 deferred batch)
**Structure verdict (chunking probe):** FLAT-RISK (no [H1]/[H2] markers in extract; relies on SECTION ## labels)

**Part 1 - Identification**
- id_in_document: PB-004
- title_matches_tracker: yes ("Hourly Employee Handbook")
- version_drift_finding: none - on-disk v1.2 matches tracker v1.2. Effective date 6/12/2026 stated.

**Part 2 - Document-level**
- A1 Accuracy: PASS - no food-safety temps stated as numbers (correct; PB-004 stays out of temp territory and points at PB-002/SOP-002). Brand promise stated correctly in §01 and §05. ServSafe Food Handler + Allergen named correctly per tracker.
- A2 Actionability: PASS - ESL-readable, short sentences, clear "what to do" per section. Section 09 "Who to Call" table is concrete. Excellent fit for hourly audience.
- A3 Completeness/Actuals: PASS with note - well-formed; §09 names Mariela Chavez (HR) and routes appropriately. Referral program (§06) deliberately vague ("ask your manager about the current referral program") which is correct for a handbook (program details change).
- A4 Format/Metadata: ISSUES - owner field reads "Human Resources" (department, not role title) - per STD-001 §10 this is a role-title violation. Flagged in Kevin's deferred owner-field sweep (per memory). All other metadata block elements present. Cover page, contents block, Related Documents block at end.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - no fill-in placeholders.
  - chunking_readiness: FLAT-RISK - extract shows zero [H1]/[H2] markers; only "SECTION ##" pseudo-headers. Will likely chunk as one blob unless Word-style real Heading levels exist in .docx.
  - number_hygiene: clean - no figures/dates/$ that would mislead Sous. "founded in 2012" is verifiable fact; states list (FL, TX, AZ, NY, IL) is correct per rubric §2.

**Part 3 - Library checks**
- cross_refs_in_text: AGR-001 (§02, §06), POL-001 (§07, §09), POL-002 (§04), PB-002 (§05), SOP-002 (§07), SOP-004 (§07). Rippling referenced throughout for cert tracking. References Map seed already lists these.
- inbound_retired_pointer: NO - no reference to REF-009 (correctly absent; cert tracking lives in Rippling per memory note). No POL-005/017/018 references. PASS.
- contradiction_within_doc: none. Brand promise spelled identically in §01 and §05.
- terminology_drift: minor - §04 NOTE references "People Operations" (Spanish-language summary "available from People Operations"). Per rubric §2, the convention is Human Resources, not "People Operations." Same drift in §05, §07, §08, §09. The owner field is "Human Resources" but in-body the doc uses "People Operations" repeatedly. This is internal inconsistency.
- legal_flag: LEGAL-REVIEW §07 Equal Treatment / Accommodations language and §06 Conduct That Can Get You Terminated language are policy-edge content. Counsel should review the immediate-termination list to ensure it tracks with at-will / state law.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | Owner = "Human Resources" (department, not role title) per STD-001 §10 | Change to role title (e.g., "Director of People & HR" per Kevin's STD-001 sweep) | no - already in deferred sweep |
| MAJOR | §04, §05, §07, §08, §09 | In-body references to "People Operations" while owner field says "Human Resources" - terminology inconsistency | Pick one term and apply consistently | no - convention call by Kevin |
| MAJOR | A5 chunking | FLAT-RISK structure - no real Heading levels visible in extract; "SECTION ##" pseudo-headers will not chunk cleanly | Apply Word Heading 1/2/3 styles to section labels | no |
| MINOR | §06 Tips/Gratuity | "distributed among hourly employees based on hours worked" - reasonable but no formula. May want POL-008 pointer | Add "(see POL-008 for wage and tip handling)" if relevant | maybe - confirm tip distribution model |
| MINOR | §08 Seasonal Employment | "begins and ends with the season" - aligns with POL-013 but POL-013 isn't pointed at in §08 | Add POL-013 reference to Related Documents | no |
| LEGAL-REVIEW | §06 conduct list, §07 protections | Immediate-termination grounds list and accommodation language | Counsel review | no |

**Part 5 - Catalog row draft**
- card_line: "Your handbook. What KitchFix expects, what you can expect from us, and who to call."
- summary: "The hourly employee handbook. Welcome from Chef Josh, brand promise, first-shift readiness, attendance, uniform, food safety, conduct, rights and protections, pay, and a Who-to-Call directory. The floor for every hourly KitchFix employee. Built to be readable by hourly and ESL staff; Spanish companion is PB-004-ES."
- keywords: handbook, hourly, onboarding, uniform, food-safety, attendance, conduct, ServSafe, Big Rules, Rippling
- shelf_proposed: HR & People
- audience_proposed: operator
- status_proposed_opd_enum: In Review (pending CK-2 confirmation)

**Part 6 - Live-readiness**
- version_present: yes (v1.2)
- card_line_present: no (catalog draft above provides)
- owner_present_role_title: NO - "Human Resources" is department
- approver_present: yes ("SLT · 06/2026")
- summary_keywords_present: no in-doc, drafted above
- chunking_ready_real_headings: NO (FLAT-RISK)
- Blocks to Live: owner-field sweep, in-body "People Operations" vs "Human Resources" consistency, chunking re-style, counsel review of §06/§07

**Part 7 - SME/actuals**
- SME: HR (Mariela), Counsel
- Actual needed from Kevin: tip-distribution model under §06 if it varies by account; confirm preferred term ("Human Resources" vs "People Operations") for in-body usage

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: content is strong and operator-fit; owner-field STD-001 violation, "People Ops" vs "HR" inconsistency, and counsel review of terminable-conduct list block Live status. Once those resolve, this is a clean Live doc.

---

### PB-007 Workplace Safety Manual v1.0

**File:** PB-007_Workplace_Safety_Manual_v1_0.txt
**Tracker status / version:** In review (v1.0) - HR
**Structure verdict (chunking probe):** FLAT-RISK (no [H1]/[H2] markers; OSHA-aligned 15-section manual)

**Part 1 - Identification**
- id_in_document: PB-007
- title_matches_tracker: yes ("Workplace Safety Manual")
- version_drift_finding: none

**Part 2 - Document-level**
- A1 Accuracy: PASS - the cut-glove rule is correctly stated (competency-based via FORM-009; mandatory regardless of verification on mandoline/slicer/deboning/shellfish/blade cleaning). Grease-fire callout (§08 CRITICAL) correctly says smothered not watered. PASE/PASS extinguisher mnemonic correct. §02 correctly points injury reporting at SOP-002. §11 correctly points emergencies at PB-008.
- A2 Actionability: PASS - cook-on-tomorrow specific. PPE table in §05 is concrete (task -> required PPE). Call-the-kitchen mnemonic ("BEHIND, CORNER, HOT, KNIFE, HEAVY") in §06. Clear ownership in §03.
- A3 Completeness/Actuals: ISSUES - §14 "report... within the required timeframe" is vague; should name the 8-hour fatality / 24-hour amputation/in-patient/loss-of-eye OSHA window if PB-007 intends to be self-sufficient on that point. §13 mentions "ServSafe and any required certifications" but does not name the cadence/renewal interval. §15 names The Hartford as carrier - this is a verifiable actual; flag for Kevin to confirm current.
- A4 Format/Metadata: ISSUES - same owner-field violation: "Human Resources" instead of role title. All other STD-001 elements present (cover, metadata block, contents with page nums, sections numbered, Related Documents at end).
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - no fill-in placeholders.
  - chunking_readiness: FLAT-RISK - same pseudo-section issue.
  - number_hygiene: §14 OSHA timeframe omitted (Sous can't quote it); §15 carrier name "The Hartford" is a real fact (good); no placeholder $/dates.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-002 (§02 §11 §12 §14 §15 - SAFETY system of record correctly identified), SOP-010 (§02), PB-008 (§02 §11), SOP-008 (§04 §13), REF-008 (§02 §14), FORM-009 (§06), TPL-019 (§08), REF-001 (§15), STD-001 (Related Documents). Kevin's note in the prompt: §02 / §14 were repointed from retired SOP-011 to SOP-002 - **confirmed the file reflects this** - no SOP-011 references found anywhere.
- inbound_retired_pointer: YES - **CRITICAL**. Two references to **REF-008** (§02 "Satellites carry the detail - ... permits and licenses (REF-008)" and §14 "Keep site permits and licenses current and tracked (REF-008)" and again §14 NOTE "Permits and licenses are REF-008"). Per manifest retired set, **REF-008 was reclassified to POL-019** (Permit & License Compliance Policy). Three pointers in this doc to the retired ID.
- contradiction_within_doc: none on shared facts.
- terminology_drift: minor - "Human Resources" in owner field is correct convention per memory, but field says "Human Resources" while §15 says "HR" / "Human Resources coordinates every claim" - mixed casing is cosmetic.
- legal_flag: LEGAL-REVIEW §14 OSHA reporting language and §15 workers' comp / no-retaliation language - counsel should sanity-check the OSHA-window omission and the no-retaliation wording.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | §02, §14 (x2) | Live pointer to retired REF-008 - 3 occurrences. Per manifest, REF-008 was reclassified to POL-019 | Repoint all three to POL-019 Permit & License Compliance Policy | no - manifest names replacement |
| MAJOR | Metadata | Owner = "Human Resources" not role title (STD-001 §10) | Per deferred sweep | no |
| MAJOR | A5 chunking | FLAT-RISK - no real Heading levels | Apply Word styles | no |
| MAJOR | §14 | "Report... within the required timeframe" - OSHA windows (8h fatality / 24h amputation/in-patient/loss-of-eye) are not named. Doc says "reporting process is in SOP-002" - if SOP-002 has these, fine; if not, surface the gap | Add explicit timeframes or confirm SOP-002 has them | yes - confirm SOP-002 carries the timeframes |
| MINOR | §15 | "The Hartford" carrier - confirm still current | Confirm or update | yes - confirm carrier |
| MINOR | §13 | Cert renewal cadence not stated ("kept current") | Add cadence or "per Rippling renewal schedule" | maybe |
| LEGAL-REVIEW | §14, §15 | OSHA-reporting language and workers'-comp retaliation language | Counsel review | no |

**Part 5 - Catalog row draft**
- card_line: "Work safe. The KitchFix safety program - PPE, knives, fire, lifting, heat, emergencies - and how it all connects."
- summary: "KitchFix's occupational-safety program built on OSHA standards. Covers safety management roles, HazCom and chemical safety, PPE by task, knife and equipment safety (incl. competency-based cut-glove rule via FORM-009), slips/trips, burns and fire (grease-fire smothered not watered), lifting and ergonomics, heat illness, emergency action, injury reporting (routes to SOP-002), training, recordkeeping, and workers' compensation. Prevention here; response in SOP-002; emergencies in PB-008."
- keywords: safety, OSHA, PPE, knives, cut-glove, fire, grease-fire, heat-illness, ergonomics, workers-comp
- shelf_proposed: Safety
- audience_proposed: operator
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: NO
- approver_present: yes ("SLT")
- summary_keywords_present: no in-doc
- chunking_ready_real_headings: NO
- Blocks to Live: retired-REF-008 repoint to POL-019 (3 places), owner-field sweep, OSHA window confirm vs SOP-002, carrier confirm

**Part 7 - SME/actuals**
- SME: HR (Mariela), Counsel
- Actual needed from Kevin: confirm The Hartford is current carrier; confirm OSHA windows live in SOP-002 §10 (or add them here)

**Part 8 - Verdict**
- NOT-READY
- Rationale: three live pointers to the retired REF-008 ID is CRITICAL - this is exactly the inbound-retired-pointer category. Fixes are mechanical but must happen before Live.

---

### PB-008 Emergency Prep & Continuity v1.0

**File:** PB-008_Emergency_Prep_Continuity_v1_0.txt
**Tracker status / version:** In review (v1.0) - Sr Dir Ops
**Structure verdict (chunking probe):** FLAT-RISK

**Part 1 - Identification**
- id_in_document: PB-008
- title_matches_tracker: yes
- version_drift_finding: none

**Part 2 - Document-level**
- A1 Accuracy: PASS - Run/Hide/Fight per §07 correctly routes to SOP-002 §07.9. Grease-fire callout in §04 correctly cross-points to PB-007 §08. §05 medical emergency list is appropriate. §08 utility failure correctly routes to SOP-015 for food keep/discard.
- A2 Actionability: PASS - clear "what to do" per emergency type. Florida/Texas/AZ/Midwest/Northeast region split in §06 matches actual KitchFix footprint per rubric §2.
- A3 Completeness/Actuals: ISSUES - §02 EAP "each site's plan is specific to its building" - correct architecture (floor + site-specific overrides). However, no template or pointer to where the per-site EAP gets built/stored. §10 Business Continuity is a strong framework but very abstract ("identify what must keep running," "plan backup prep," "vendor backups") - no working examples, no specific KitchFix sister-site mappings. This is the "thin where it should be specific" pattern - flag.
- A4 Format/Metadata: PASS - owner = "Senior Director of Operations" (role title - good!). Metadata block clean. STD-001 elements present.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - no fill-in content presented as fact.
  - chunking_readiness: FLAT-RISK - no real Heading levels.
  - number_hygiene: clean - no $/date placeholders.

**Part 3 - Library checks**
- cross_refs_in_text: PB-007 (§01 §04 §06), SOP-002 (§01 §05 §07 §09 - correctly used as the incident-reporting anchor), SOP-015 (§08 - utility failure / food keep-or-discard), SOP-010 (§06 winter driver safety), PB-002 (§05 allergen reactions), REF-001 (Related Docs), STD-001 (Related Docs). §07 Active Threat correctly points at SOP-002 §07.9 per prompt expectation.
- inbound_retired_pointer: NO - **PASS**. No SOP-011, no SOP-016, no REF-008 references. Correctly routes utility failure to SOP-015. Correctly omits the absorbed SOP-016 foodborne-illness path.
- contradiction_within_doc: none.
- terminology_drift: minor - "Human Resources" used in §07 ("Notify Human Resources and corporate") - matches convention.
- legal_flag: no.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | A5 chunking | FLAT-RISK structure | Apply Word styles | no |
| MAJOR | §02 EAP | No pointer to where per-site EAP lives or template to build it from | Either name the EAP template ID or note "per-site EAP filed in [location]" | yes - is there an EAP template? |
| MAJOR | §10 Business Continuity | Highly abstract - no working sister-site backup mapping; no named backup vendors; no defined "critical function" inventory per account model | Either name the model (MLB clubhouse meals = critical) and a sister-site mapping rule, or flag as Phase-2 build | yes - business continuity actuals are KitchFix-only knowledge |
| MINOR | §12 Version History | Listed in Contents (§12) but not present in body | Add Version History block or fix Contents | no |

**Part 5 - Catalog row draft**
- card_line: "When something bad happens - fire, weather, medical, threat, utility - the plan and the order of moves."
- summary: "Emergency preparation and business continuity for every KitchFix site. The Emergency Action Plan structure, evacuation and accountability, fire response (incl. grease-fire), medical emergencies, severe-weather playbook by region (hurricane FL / tornado Midwest+TX / heat AZ-TX-FL / winter Midwest+NE), security and Run-Hide-Fight, utility failure (with SOP-015 for food calls), emergency communication, business continuity, and drills. Satellite of PB-007 (prevention); incident reporting still lives in SOP-002."
- keywords: emergency, evacuation, fire, hurricane, tornado, active-threat, utility-failure, business-continuity, EAP, drills
- shelf_proposed: Safety
- audience_proposed: operator
- status_proposed_opd_enum: In Review (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: YES (Senior Director of Operations)
- approver_present: Pending - SLT (acknowledged)
- summary_keywords_present: no in-doc
- chunking_ready_real_headings: NO
- Blocks to Live: chunking re-style, per-site EAP pointer/template, business continuity actuals, Version History block

**Part 7 - SME/actuals**
- SME: Sr Dir Ops, possibly Britt for kitchen-down sister-site backup
- Actual needed from Kevin: per-site EAP template or filed location; sister-site backup mapping; named backup vendors per critical category

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: clean cross-references, no retired pointers, proper owner field. Blocked by business-continuity actuals (sister-site backups, vendor backups) and per-site EAP pointer. Content quality good.

---

### PB-009 Financial Operations Manual v1.0

**File:** PB-009_Financial_Operations_Manual_v1_0.txt
**Tracker status / version:** Not started per tracker; file on disk is "v1.0" framework draft - tracker reconciliation needed
**Structure verdict (chunking probe):** FLAT-RISK

**Part 1 - Identification**
- id_in_document: PB-009
- title_matches_tracker: yes
- version_drift_finding: **TRACKER MISMATCH** - tracker says "Not started" but file is on disk at v1.0 with content. Per CK-2 reconciliation list, this is one of the known reconciliations.

**Part 2 - Document-level**
- A1 Accuracy: PASS - the two financial models (fee vs full-service) described correctly per rubric §2. Brand-promise not stated (correct - this is a finance doc).
- A2 Actionability: ISSUES - much of the doc is framework-level. §07 Invoicing/AP, §08 Billing/Receivables, §09 Reporting, §10 Controls all have "[OPEN - FINANCE INPUT]" placeholders. The Executive Chef cannot act on tomorrow from this doc as written; an RDO can use it directionally. This is acknowledged in §01 NOTE.
- A3 Completeness/Actuals: ISSUES - **multiple [OPEN - FINANCE INPUT] placeholders** in §01, §06, §07, §08, §09, §10. The doc is honest about being a framework awaiting Sebastian (Accounting) input. The structure is right; the actuals are missing. Variance escalation table in §11 is concrete and usable.
- A4 Format/Metadata: ISSUES - **OWNER FIELD MISSING ENTIRELY** between APPROVED BY and NEXT REVIEW; no Owner row. STD-001 §10 violation - owner is required. Approved By says "Accounting + SLT." Classification is "KitchFix Internal - Restricted" which is appropriate for finance.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: **HIGH** - placeholders like "approval thresholds... to be confirmed" are written in the body. Sous could retrieve "The reporting pack structure... are framework placeholders" as if it were policy. Body text states uncertainty inline.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: no specific $ figures (because actuals not filled in). The placeholders themselves are the risk.

**Part 3 - Library checks**
- cross_refs_in_text: PB-010 (§04 Food Cost, §07 Invoicing receiving cross-ref), POL-008 (§05 labor / wage-hour), POL-013 (§05 seasonal), STD-001 (Related Docs). PB-005, PB-012 in Related Docs. Sebastian Castro named in §01, §07.
- inbound_retired_pointer: NO - clean.
- contradiction_within_doc: none.
- terminology_drift: §07 step 1 says "PB-010, Section receiving" - section number not given (should be PB-010 §08 per non-dup or §08 per dup). MINOR.
- legal_flag: no - finance internal doc; no policy-edge content.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | OWNER field entirely missing from metadata block - STD-001 §10 violation | Add Owner row with role title (likely "VP Ops" or "Director of Accounting" per tracker "Acct / VPO") | yes - confirm canonical owner role |
| MAJOR | A5 template-as-canonical | [OPEN - FINANCE INPUT] placeholders sit in body text (not callouts) - Sous risk | Either gate doc to NOT-LIVE until placeholders close, or move them to a single "Pending Inputs" callout | no |
| MAJOR | A3 completeness | 6 sections (§01, §06, §07, §08, §09, §10) carry FINANCE-INPUT placeholders | Sebastian to fill: approval matrix, AP workflow, reporting pack, budget format/cadence | yes - Sebastian input |
| MAJOR | A5 chunking | FLAT-RISK | Apply Word styles | no |
| MAJOR | Tracker | Tracker says "Not started" but file at v1.0 - reconcile | Tracker update at CK-2 | no |
| MINOR | §07 step 1 | "PB-010, Section receiving" - cross-ref by name not number | Use section number once PB-010 is canonical | no |
| MINOR | §12 Version History | Not in body | Add Version History block | no |

**Part 5 - Catalog row draft**
- card_line: "The money playbook - the two models, site P&L, food and labor cost, billing, reporting, controls."
- summary: "How KitchFix manages the financial side: the two contract models (fee vs full-service), site P&L ownership (EC accountable, RDO oversees, Accounting maintains), food cost discipline, labor cost discipline, budgeting and forecasting, invoicing and AP, client billing and receivables, financial reporting, controls and approvals, and variance management. Several sections are framework-level pending Accounting input; not yet ready as a Live operator reference for AP workflow or reporting cadence."
- keywords: finance, P&L, food-cost, labor-cost, fee-model, full-service, invoicing, billing, variance, controls
- shelf_proposed: Finance
- audience_proposed: corporate
- status_proposed_opd_enum: Draft (pending CK-2; should NOT be marked Live until Finance Input closes)

**Part 6 - Live-readiness**
- version_present: yes (v1.0)
- card_line_present: no
- owner_present_role_title: **NO - field absent**
- approver_present: yes ("Accounting + SLT")
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: Owner field add, 6 FINANCE-INPUT closures by Sebastian, Version History block, chunking re-style

**Part 7 - SME/actuals**
- SME: Sebastian Castro (Accounting), possibly Joe Lessard (VP Ops)
- Actual needed from Kevin: confirm Owner role title (Accounting Director? VP Ops?). Sebastian owes the approval matrix, AP workflow, reporting pack, billing cadence, budget format.

**Part 8 - Verdict**
- NOT-READY
- Rationale: doc is a structurally sound framework but is explicitly framework-only in 6 sections. Missing Owner field. Cannot go Live without Sebastian fill-in.

---

### PB-010 Site Operations Manual v1.0 (NON-DUP)

**File:** PB-010_Site_Operations_Manual_v1_0.txt
**Tracker status / version:** Draft (v1.0) - Sr Dir Ops
**Structure verdict (chunking probe):** FLAT-RISK

**Part 1 - Identification**
- id_in_document: PB-010
- title_matches_tracker: yes
- version_drift_finding: none on label; but see duplicate diff below.

**Part 2 - Document-level**
- A1 Accuracy: ISSUES - §05 hot/cold temps correct (135F / 41F). **CRITICAL terminology issue:** §08 Inventory states "Galley is the recipe system of record - build and cost to it." Per rubric §2: "Galley is NOT the recipe system of record. Generic recipe/production-list language is correct. Naming Galley as the system of record IS a finding."
- A2 Actionability: PASS - the 13-section structure is operator-fit. Opening checklist (§04) and closing checklist (§06) are concrete and ordered.
- A3 Completeness/Actuals: ISSUES - compared to the (1) duplicate, this version is THINNER. Lacks Menu & Production Planning, Equipment & Smallwares Care, Team/Training, Site Financial Discipline, Reporting Cadence sections.
- A4 Format/Metadata: PASS - owner = "Senior Director of Operations" (role title - good). All STD-001 elements present.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: **HIGH** - "Galley is the recipe system of record" would be retrieved by Sous as canonical fact and is wrong.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: 135F/41F correct.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-008 (§04, §05, §06, §08, §09, §12 - extensive, correct), TPL-018 (§04, §09), SOP-002 (§01, §12, Related Docs), PB-007 (§01, Related Docs), PB-002 (§05, §09), TPL-019 (§06, §09), POL-014 (§10 x2), POL-002 (§10), POL-008 (§07, Related Docs), CHK-003 (§09, §11, Related Docs), STD-001 (Related Docs).
- inbound_retired_pointer: NO - clean retired-set check.
- contradiction_within_doc: none on shared facts.
- terminology_drift: **CRITICAL** - "Galley is the recipe system of record" in §08. Also brand-promise wording in §05 is "Best Food, Best Service, Best Hospitality" (correct).
- legal_flag: no.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| CRITICAL | §08 Inventory, Ordering & Receiving | "Galley is the recipe system of record - build and cost to it." Per rubric §2, this is the named terminology-drift category | Replace with generic "Standardized recipes and production lists are built and costed centrally" language - the (1) duplicate already does this correctly | no - convention call |
| MAJOR | A5 template-as-canonical | The Galley line is the Sous-retrieval risk if this version stays canonical | Use (1) duplicate as canonical (see diff below) | no |
| MAJOR | A5 chunking | FLAT-RISK | Apply Word styles | no |
| MAJOR | Document choice | This file is THINNER than the (1) duplicate - 13 vs 17 sections, missing Menu, Equipment, Team/Training, Site Financial, Reporting Cadence | Recommend (1) duplicate as canonical | no - see verdict in cross-batch |

**Part 5 - Catalog row draft**
- card_line: "How a KitchFix site runs every day - rhythm, roles, open, service, close, escalation."
- summary: "The Site Operating System manual: leadership triad and shift ownership, daily rhythm (open/prep/huddle/service/reset), opening and closing checklists, service execution and hospitality, staffing/scheduling/labor, inventory and ordering, food safety summary (pointing to SOP-008), client-house operating standards, and escalation. Sets the floor; site-specific overrides on top."
- keywords: site, operations, rhythm, EC, opening, closing, service, inventory, escalation, daily-walk
- shelf_proposed: Site & Client (or Operations)
- audience_proposed: operator
- status_proposed_opd_enum: Draft (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: YES (Senior Director of Operations)
- approver_present: Pending - SLT
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: Galley line removal (CRITICAL), choose canonical between this and (1), chunking re-style

**Part 7 - SME/actuals**
- SME: Sr Dir Ops (Kevin) - the canonical-version call
- Actual needed from Kevin: which of the two PB-010 files is the canonical Draft

**Part 8 - Verdict**
- NOT-READY
- Rationale: CRITICAL Galley-as-system-of-record terminology drift, plus this is the thinner of two on-disk versions. Recommend deprecating this version in favor of (1) - see cross-batch diff.

---

### PB-010 Site Operations Manual v1.0 (DUPLICATE FILE "(1)")

**File:** PB-010_Site_Operations_Manual_v1_0 (1).txt
**Tracker status / version:** n/a (file is the duplicate flagged in manifest)
**Structure verdict (chunking probe):** FLAT-RISK (same)

**Part 1 - Identification**
- id_in_document: PB-010
- title_matches_tracker: yes
- version_drift_finding: same v1.0 label as non-dup, but content differs - see DIFF below.

**Part 2 - Document-level**
- A1 Accuracy: PASS - 135F / 41F correct in §10. Brand promise correct. **The Galley line is GONE.** §07 Menu & Production Planning instead says "Standardized recipes and production lists keep the food consistent and costed, whoever is on the line" - generic language, correct per rubric §2.
- A2 Actionability: PASS - 17-section structure, more complete. Adds Menu & Production Planning (§07), Equipment & Smallwares Care (§09), Team: Hiring/Training (§12), Site Financial Discipline (§13), Reporting & Comm Cadence (§15). All operator-actionable.
- A3 Completeness/Actuals: PASS - much more complete than the non-dup. The Reporting Cadence table in §15 names TPL-007/008/009/011 with cadence.
- A4 Format/Metadata: PASS - same metadata block as non-dup, owner = Senior Director of Operations.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - Galley issue resolved here.
  - chunking_readiness: FLAT-RISK - same.
  - number_hygiene: 135F/41F correct; no $ placeholders.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-008 (multiple), SOP-002 (multiple), PB-007 (§01, §09 equipment lockout, Related Docs), PB-002 (§05, §10), TPL-018 (§04, §10), TPL-019 (§06, §10), TPL-007/008/009/011 (§15), POL-008 (§11), POL-013 (§12), POL-014 (§14), POL-002 (§14), CHK-003 (§10, §16, Related Docs), FORM-009 (§09 cut-glove and §12 onboarding), PB-006 (§07 menu / Related Docs - note PB-006 is "In review v0.3" Draft per manifest, listed as "Live" in Related Docs - drift), PB-009 (§13, Related Docs - status "Live" in Related Docs but PB-009 is itself Not-Started-with-file per tracker - drift), PB-011 (§07 - Not-started per manifest, not in Related Docs), PB-013 (Related Docs - status "Live" but PB-013 is Not-Started-with-file too - drift), STD-001 (Related Docs).
- inbound_retired_pointer: NO - clean.
- contradiction_within_doc: none.
- terminology_drift: **none on Galley** (resolved). However, the Related Documents block marks PB-006, PB-009, PB-013, SOP-002, PB-007, PB-002, SOP-008, CHK-003, FORM-009, TPL-007, POL-008 all as "Live" - several of these are NOT actually Live per manifest (PB-006, PB-009, PB-013, SOP-008, CHK-003, FORM-009 are In Review or Draft). MAJOR status-label drift.
- legal_flag: no.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Related Documents | Multiple status labels show "Live" for docs that are In Review or Draft per manifest (PB-006, PB-009, PB-013, SOP-008, CHK-003, FORM-009) | Update status column to match current tracker | no |
| MAJOR | A5 chunking | FLAT-RISK | Apply Word styles | no |
| MINOR | §07 | References PB-006 / PB-011 - PB-011 is "Not started" per manifest; doc OK to reference but Related Docs should reflect it | Add PB-011 to Related Docs or update note | no |
| MINOR | Version History | Not present in body though no §13 Version History label in TOC either | Add per STD-001 | no |
| MAJOR | Duplicate-file status | This (1) file is the more complete / Galley-corrected version - should be designated canonical | Rename to PB-010_Site_Operations_Manual_v1_1.docx and retire the non-dup, or replace non-dup with this file | no - Kevin canonical-call |

**Part 5 - Catalog row draft**
- card_line: "How a KitchFix site runs every day - rhythm, roles, open, service, close, menu, equipment, team, financial, client, escalation."
- summary: "The Site Operating System manual. 17 sections: leadership triad and shift ownership, daily rhythm (open/prep/huddle/service/reset), opening and closing checklists, service execution and hospitality, menu and production planning, inventory and ordering, equipment and smallwares care, food safety (points to SOP-008), staffing/scheduling/labor, team hiring and training, site financial discipline, client-house operating standards, reporting cadence, standards and self-audit, and escalation. Sets the floor; site-specific overrides on top. The operating spine that connects food safety, safety, finance, training, and client management."
- keywords: site, operations, rhythm, EC, opening, closing, menu, production, equipment, P&L, reporting, escalation
- shelf_proposed: Site & Client
- audience_proposed: operator
- status_proposed_opd_enum: Draft (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: YES (Senior Director of Operations)
- approver_present: Pending - SLT
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: Related Docs status-label cleanup, canonical-file designation, chunking re-style

**Part 7 - SME/actuals**
- SME: Sr Dir Ops (Kevin)
- Actual needed from Kevin: canonical-file designation; confirm 17-section is the intended scope

**Part 8 - Verdict**
- READY-PENDING-SME (would be READY but for canonical-call and Related Docs status drift)
- Rationale: this is the better of the two PB-010 files. Galley line removed. More complete. Once Kevin designates it canonical and Related Docs status column gets a sweep, this is the doc that should carry PB-010 forward.

---

### PB-012 Client & Account Management Playbook v1.0

**File:** PB-012_Client_Account_Management_Playbook_v1_0.txt
**Tracker status / version:** Not started per tracker; file present at v1.0 - reconciliation needed
**Structure verdict (chunking probe):** FLAT-RISK

**Part 1 - Identification**
- id_in_document: PB-012
- title_matches_tracker: yes
- version_drift_finding: **TRACKER MISMATCH** - tracker says "Not started" but file at v1.0 on disk. CK-2 reconciliation item.

**Part 2 - Document-level**
- A1 Accuracy: PASS - brand promise stated correctly in §02. Fee/full-service model named correctly in §04 (routes to PB-009).
- A2 Actionability: PASS - 11 content sections plus Related Documents. New-account checklist (§05) is concrete. Client cadence table (§06) is concrete.
- A3 Completeness/Actuals: ISSUES - §06 names check-in cadence categories but no specific frequency ("regular check-in" not weekly/monthly). §08 mentions "Fun Money / event budgets" as a category but doesn't define typical scope. §11 Renewals mentions "renewal window" but no example timeline. These are operational realities Kevin and the RDOs would know.
- A4 Format/Metadata: ISSUES - **OWNER FIELD MISSING** (blank between APPROVED BY and CLASSIFICATION). STD-001 §10 violation.
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: low - no placeholders presented as fact.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: clean.

**Part 3 - Library checks**
- cross_refs_in_text: PB-005 (§01, §04 SLA, §05, Related Docs), PB-009 (§04, §07, Related Docs), PB-010 (§01, §05, §07, §08, Related Docs), PB-006 (§08 menu changes), PB-003 (§09 service recovery), PB-002 implicitly via PB-010, POL-014 (§10 x2), POL-002 (§10), TPL-011 (§06, Related Docs), TPL-014 (§04, §05, Related Docs), STD-001 (Related Docs).
- inbound_retired_pointer: NO - clean.
- contradiction_within_doc: none.
- terminology_drift: none.
- legal_flag: no - internal partnership-management playbook.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | OWNER field blank/missing - STD-001 §10 violation | Add Owner = role title; per tracker = "Sr Dir Ops / RDO" - pick canonical role | yes - confirm owner role |
| MAJOR | A5 chunking | FLAT-RISK | Apply Word styles | no |
| MAJOR | Tracker | Tracker says "Not started" but file at v1.0 | CK-2 reconciliation | no |
| MINOR | §06 Cadence | "Regular check-in" / "Periodic business review" - no defined frequency | Define ABR/QBR cadence or refer to PB-005 SLA terms | yes - cadence actuals |
| MINOR | §08 | "Fun Money / event budgets" mentioned but undefined | Add definition or example | maybe |
| MINOR | §11 Renewals | "Renewal window" not named | Add typical timeline if standard | maybe |
| MINOR | §12 Version History | Listed in Contents but not in body | Add Version History block | no |

**Part 5 - Catalog row draft**
- card_line: "How we keep accounts - the relationship, the SLA, the cadence, and the renewal."
- summary: "The Client & Account Management Playbook. How KitchFix manages partner accounts: account relationship as the underlying asset, account roles (RDO owns the relationship, EC owns the daily experience), the SLA (operating agreement, routes to PB-005), standing up a new account, client cadence (daily touchpoint, regular check-ins, periodic business review), account health (operational, satisfaction, financial, renewal signals), managing change (menu, scope, event budgets), issues and complaints (PB-003 service recovery), conduct in the client's house (POL-014 / POL-002), and renewals and growth. The how; the SLA itself lives in PB-005."
- keywords: client, account, SLA, RDO, cadence, ABR, QBR, renewal, retention, dietitian
- shelf_proposed: Site & Client
- audience_proposed: corporate
- status_proposed_opd_enum: Draft (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: **NO - field blank**
- approver_present: Pending - SLT
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: Owner field add, chunking re-style, cadence specifics

**Part 7 - SME/actuals**
- SME: Sr Dir Ops (Kevin), RDOs
- Actual needed from Kevin: confirm Owner role title; define ABR/QBR cadence; define Fun Money scope; define renewal window

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: clean references, no retired pointers, content is operator-fit. Blocked by missing owner field and a few cadence actuals.

---

### PB-013 Training & Certification Program v1.0

**File:** PB-013_Training_Certification_Program_v1_0.txt
**Tracker status / version:** Not started per tracker; file present at v1.0 - reconciliation needed
**Structure verdict (chunking probe):** FLAT-RISK

**Part 1 - Identification**
- id_in_document: PB-013
- title_matches_tracker: yes
- version_drift_finding: **TRACKER MISMATCH** - tracker says "Not started" but file at v1.0. CK-2 reconciliation.

**Part 2 - Document-level**
- A1 Accuracy: PASS - food-safety / allergen references correctly route to SOP-008 and PB-002 (per prompt expectation; correctly avoids POL-005, POL-018 retired set). FORM-009 named for knife-skills verification. Top 9 allergens correctly described per PB-002 anchor. Rippling correctly named as cert-tracking system.
- A2 Actionability: ISSUES - §05 Required Certifications explicitly has "[OPEN - HR INPUT]" for the certification matrix. The structure is right; the actuals - which certifications for which roles in which states - are not yet listed.
- A3 Completeness/Actuals: ISSUES - same §05 placeholder. §07 Leadership Development names SOP-007 (Hourly Performance) which is "Staged/tabled until August" per manifest - this is fine to reference but the doc says "(SOP-007)" with status "In review" in Related Docs whereas SOP-007 is actually Staged.
- A4 Format/Metadata: ISSUES - **OWNER FIELD MISSING** (blank between APPROVED BY and CLASSIFICATION). STD-001 §10 violation. Approved By says "Pending - HR + SLT."
- A5 SousAI-readiness: ISSUES
  - template_as_canonical_risk: **MODERATE** - §05 [OPEN - HR INPUT] sits in body callout (not body sentence) - lower risk than PB-009's body-text placeholders. §01 NOTE also flags the open input.
  - chunking_readiness: FLAT-RISK.
  - number_hygiene: §05 references "eight states (AZ, FL, IL, KY, MO, NY, OH, TX)" - matches rubric §2 fact. Good.

**Part 3 - Library checks**
- cross_refs_in_text: SOP-005 (§01, §03, Related Docs), TPL-016 (§01, §03, §09, Related Docs), AGR-001 (§03), PB-007 (§03), SOP-002 (§03), SOP-008 (§03, §06, Related Docs), PB-002 (§03, §06, Related Docs), FORM-009 (§03, §05, §09, Related Docs), CHK-003 (§06), SOP-009 (§06, §10, Related Docs - note SOP-009 is Not Started per manifest), SOP-001 (§07, Related Docs), SOP-007 (§07 - Staged), TPL-001/002/003/004/010 (§07 - all Staged), STD-001 (Related Docs).
- inbound_retired_pointer: **NO** - **PASS**. Verified per prompt expectation:
  - No POL-005 reference (correctly absent - social media coverage stays in PB-004 §06).
  - No POL-018 reference (correctly absent - folded into POL-015).
  - Harassment training references POL-006 by allusion - doc does NOT cite the retired POL-005.
  - The prompt asked: "Should reference allergen / safety / harassment training - check it points to PB-002, PB-007, POL-006." Verified: PB-002 yes, PB-007 yes. **However, POL-006 (Anti-Harassment) is NOT explicitly cited in PB-013** - harassment training is implied via AGR-001 reference in §03 but POL-006 is missing from cross-refs. Flag as gap.
- contradiction_within_doc: none.
- terminology_drift: "Human Resources" used in §10 ("Human Resources - owns the program") - matches convention. But Approved By header says "HR + SLT" - mixed term usage.
- legal_flag: no.

**Part 4 - Findings**
| Severity | Section | Finding | Fix | Actual Needed? |
|---|---|---|---|---|
| MAJOR | Metadata | OWNER field blank/missing - STD-001 §10 | Add Owner = role title; per tracker = "People Ops" (Mariela / Director of People & HR) | yes - confirm role title |
| MAJOR | §05 [OPEN - HR INPUT] | Certification matrix by role x state is the actual content; without it, the section is structural | Mariela / HR fills the matrix | yes - HR matrix |
| MAJOR | Cross-refs gap | POL-006 Anti-Harassment NOT referenced in §03 (Onboarding Training) or Related Docs - per prompt expectation, harassment training should point at POL-006. Currently routes only via AGR-001 §03 | Add POL-006 to §03 onboarding list and Related Docs | no - convention call |
| MAJOR | A5 chunking | FLAT-RISK | Apply Word styles | no |
| MAJOR | Tracker | Tracker says "Not started" but file at v1.0 | CK-2 reconciliation | no |
| MINOR | Related Docs status | SOP-009 listed as "In review" in Related Docs but is "Not started" per manifest | Update status label | no |
| MINOR | §07 SOP-007 | Listed as "In review" but per manifest it's Staged/Tabled-until-August | Update if relevant | no |
| MINOR | §11 Version History | Listed in Contents but not in body | Add Version History block | no |
| MINOR | Header | "HR + SLT" vs body "Human Resources" - term consistency | Use one term | no |

**Part 5 - Catalog row draft**
- card_line: "How we train and certify - onboarding, role training, required certifications, and leadership development."
- summary: "The Training & Certification Program. How KitchFix builds competence across a seasonal, scaling workforce: training philosophy (verified not assumed, consistent everywhere), onboarding training (Big Rules, safety, food-safety, knife-skills via FORM-009), role-based training (cook / FOH attendant / dishwasher / leadership triad), required certifications (food-handler/manager, allergen, FORM-009 knife verification, state/local - matrix pending HR input), food-safety and allergen training (routes to SOP-008 and PB-002), leadership development (SOP-001 leadership system, SOP-007 hourly system, scorecards staged for August), certification tracking in Rippling, training records, and roles & responsibilities. Operates in eight states (AZ, FL, IL, KY, MO, NY, OH, TX)."
- keywords: training, certification, onboarding, ServSafe, allergen, FORM-009, Rippling, leadership-development, role-based, Top-9
- shelf_proposed: HR & People
- audience_proposed: operator + corporate
- status_proposed_opd_enum: Draft (pending CK-2)

**Part 6 - Live-readiness**
- version_present: yes
- card_line_present: no
- owner_present_role_title: **NO - blank**
- approver_present: Pending - HR + SLT
- summary_keywords_present: no
- chunking_ready_real_headings: NO
- Blocks to Live: Owner field add, §05 HR matrix fill-in, POL-006 cross-ref add, chunking re-style

**Part 7 - SME/actuals**
- SME: HR (Mariela), Sr Dir Ops
- Actual needed from Kevin: confirm Owner role; HR owes the certification matrix (role x state x provider x renewal). Confirm POL-006 should be cross-referenced.

**Part 8 - Verdict**
- READY-PENDING-SME
- Rationale: framework is solid; the actual content gap is §05 HR matrix. Owner-field missing and POL-006 cross-ref gap are mechanical fixes. Cannot go Live without the cert matrix.

---

## PB-010 DUPLICATE DIFF AND CANONICAL RECOMMENDATION

**Files compared:**
- A = PB-010_Site_Operations_Manual_v1_0.txt (referred to in this audit as the "non-dup")
- B = PB-010_Site_Operations_Manual_v1_0 (1).txt (the duplicate "(1)" file)

Both label v1.0 Draft, same metadata block, same owner (Sr Dir Ops), same Approved By (Pending - SLT).

**Structural diff:**
| | A (non-dup) | B (the "(1)" duplicate) |
|---|---|---|
| Section count | 13 (incl. §12 Version History, §13 placeholder gap) | 17 (incl. §12 Version History gap) |
| Word count proxy | ~11.5 KB | ~16.2 KB |
| Sections present | 01 Purpose, 02 Roles, 03 Rhythm, 04 Open, 05 Service, 06 Close, 07 Staffing, 08 Inventory, 09 Food Safety, 10 Client's House, 11 Self-Audit, 12 Escalation, 13 Version History | 01 Purpose, 02 Roles, 03 Rhythm, 04 Open, 05 Service, 06 Close, **07 Menu & Production Planning**, 08 Inventory, **09 Equipment & Smallwares Care**, 10 Food Safety, 11 Staffing, **12 Team: Hiring/Training/Development**, **13 Site Financial Discipline**, 14 Client's House, **15 Reporting & Communication Cadence**, 16 Self-Audit, 17 Escalation |
| Net additions in B | - | Menu & Production (§07), Equipment & Smallwares Care (§09), Team Hiring/Training (§12), Site Financial Discipline (§13), Reporting Cadence (§15) |

**Substantive content diff:**

| | A | B |
|---|---|---|
| §08 Inventory - recipe system | "**Galley is the recipe system of record** - build and cost to it. Set par levels per account and order to them." | "Set par levels per account from the menu and production plan, and order to them - not to habit." (Galley NOT named; recipe content moved to §07 Menu & Production Planning, which uses generic "Standardized recipes and production lists" language) |
| Inventory references PB-006 / PB-011 | no | yes (§07 NOTE: "Culinary standards and recipes are owned in the culinary playbook (PB-006 / PB-011)") |
| Knife-skills FORM-009 | not in main body (referenced only via cross-references in Section 09 Food Safety) | explicit in §09 Equipment ("Knife handling and the cut-glove rule follow FORM-009") and §12 Team ("knife-skills verification (FORM-009)") |
| Reporting cadence | not in body | §15 table naming TPL-007 daily site log / TPL-008 weekly site report / TPL-009 RDO rollup / TPL-011 client check-in |
| Financial discipline | not in body | §13 names fee vs full-service models, points to PB-009 |
| Training pointer | not in body | §12 NOTE: "The company training and certification program is PB-013" |
| Related Documents count | 8 docs | 12 docs (adds PB-006, PB-009, PB-013, FORM-009, TPL-007) |

**Verdict: B IS CANONICAL**

Reasons:
1. **CRITICAL terminology fix:** B removes "Galley is the recipe system of record" - the named drift-category finding in rubric §2. A still carries the wrong language. Keeping A as canonical would put a CRITICAL retrievable misstatement into the Sous corpus.
2. **B is more complete:** 17 sections vs 13. Specifically adds Menu/Production planning, Equipment care, Team training, Site Financial discipline, and Reporting cadence - all genuine operating-system content.
3. **B has stronger cross-references:** Adds pointers to PB-006, PB-009, PB-013 (the three sister manuals), FORM-009 (cut-glove gate), TPL-007/008/009/011 (reporting templates). A is missing all of these.
4. **B better honors STD-001 floor-then-override:** §15 Reporting Cadence makes the reporting rhythm explicit; A is silent on it.
5. **Neither carries retired pointers** - both clean on REF-008 etc.

**Recommended action:** Rename file B to `PB-010_Site_Operations_Manual_v1_1.docx` (version bump to reflect the substantive additions) and retire file A. Update tracker to reflect v1.1. Keep one file on disk.

**Risk note:** B still has the same Related-Docs status-label drift (showing PB-006, PB-009, PB-013, SOP-008, CHK-003, FORM-009 as "Live" when they're In Review). This is a sweep before Live, not a canonical-choice issue.

---

## Cross-batch observations

**1. CRITICAL findings summary (this batch):**
- **PB-007 has 3 inbound pointers to retired REF-008** (§02 and §14 twice). Replacement is POL-019 per manifest. This is the only retired-set pointer in the batch and must be fixed before any PB-007 Live status.
- **PB-010 (non-dup) names "Galley as recipe system of record"** in §08 - the explicit named terminology drift category from rubric §2. The duplicate (1) version corrects this. Recommend the (1) version as canonical; deprecate non-dup.

**2. No food-temperature errors (140F/40F) found anywhere in the batch.**
- PB-010 (both versions) state 135F hot / 41F cold correctly in §05 and §09/§10.
- PB-004 deliberately stays out of stating numbers (correct - points at PB-002 and managers).
- PB-007 doesn't quote temps (correct - safety manual, food temps live in SOP-008).
- PB-008 doesn't state food temps (correct - utility failure points at SOP-015 for keep/discard).
- PB-009, PB-012, PB-013 don't touch temps.

**3. Brand-promise drift: clean.**
- All brand-promise references read "Best Food, Best Service, Best Hospitality" verbatim. PB-004 §01 and §05, PB-010 §05/§11/§16, PB-012 §02. No drift to "Best Food, Best Service, Best Experience" or variants.

**4. STD-001 §10 owner-field violations - PATTERN.**
This batch has FIVE owner-field violations of two distinct types:
- **Department-name-as-role** (Kevin's deferred sweep): PB-004 and PB-007 list "Human Resources" as Owner. Per memory, this is in the deferred 11-doc batch.
- **OWNER FIELD ENTIRELY MISSING**: PB-009, PB-012, PB-013 have NO Owner row in the metadata block. This is a worse violation - not "wrong title used" but "field absent." Three of the four "newer-but-not-in-tracker" docs (PB-009, PB-012, PB-013) share this pattern. Suggests they were drafted from a template that dropped the Owner row.

PB-008 and PB-010 (both versions) correctly have "Senior Director of Operations" as a role title.

**5. Chunking readiness - ALL FLAT-RISK in this batch.**
None of the 7 distinct docs (8 files) showed [H1]/[H2]/[H3] markers in the extracted text. All rely on "SECTION ##" pseudo-headers. This is a consistent batch-D pattern and matches the manifest's FLAT-RISK flag for these docs. Pre-Live remediation must apply real Word Heading styles to every PB in this batch.

**6. "People Operations" vs "Human Resources" - inconsistent within docs.**
PB-004's Owner field says "Human Resources" but the body text repeatedly says "People Operations" (§04, §05, §07, §08, §09 NOTE). Same inconsistency pattern surfaces in PB-013 (Owner field blank, body says "Human Resources" and "HR + SLT"). Recommend Kevin pick one and sweep all docs.

**7. Tracker reconciliation surfaced (CK-2 inputs):**
- PB-009: tracker "Not started" but file at v1.0 framework-draft with [OPEN - FINANCE INPUT] gates throughout.
- PB-012: tracker "Not started" but file at v1.0 complete framework, mostly operator-ready.
- PB-013: tracker "Not started" but file at v1.0 framework with [OPEN - HR INPUT] gate at §05.
All three are "started after tracker last updated" - none are stubs. They should be moved to In Review status in the tracker.

**8. Cross-doc reference graph additions (not in References Map seed):**
- PB-007 -> SOP-002 (§02, §11, §12, §14, §15), SOP-010 (§02), PB-008 (§02, §11), SOP-008 (§04, §13), REF-008 [retired -> POL-019] (§02, §14 x2), FORM-009 (§06), TPL-019 (§08), REF-001 (§15)
- PB-008 -> PB-007 (§01, §04, §06), SOP-002 (§01, §05, §07.9, §09), SOP-015 (§08), SOP-010 (§06), PB-002 (§05), REF-001
- PB-009 -> PB-010, POL-008, POL-013, PB-005, PB-012, STD-001
- PB-010 (B/canonical) -> SOP-008, SOP-002, PB-007, PB-002, PB-006, PB-009, PB-013, PB-011, CHK-003, FORM-009, TPL-007, TPL-008, TPL-009, TPL-011, TPL-018, TPL-019, POL-008, POL-013, POL-014, POL-002, STD-001
- PB-012 -> PB-005, PB-009, PB-010, PB-006, PB-003, TPL-011, TPL-014, POL-014, POL-002, STD-001
- PB-013 -> SOP-005, SOP-008, SOP-009, SOP-007, SOP-001, SOP-002, AGR-001, PB-002, PB-007, FORM-009, TPL-016, TPL-001/002/003/004/010, CHK-003, STD-001

The Reference Map seed CSV is light on PB-007/PB-008/PB-009/PB-010/PB-012/PB-013 outbound references - this batch significantly fills out the graph. PB-010 (canonical B) is the hub of the operating-system layer (21 distinct doc IDs referenced).

**9. Thin-spot pattern across the PB manuals:**
- Business continuity actuals (PB-008 §10) - no named sister-site backups, no named backup vendors.
- Financial actuals (PB-009 §07-§10) - approval matrix, AP workflow, reporting pack are placeholders.
- Cert matrix actuals (PB-013 §05) - by-role by-state matrix is a placeholder.
- Cadence actuals (PB-012 §06) - ABR/QBR cadence not specified.

Pattern: the PB-class manuals are written by Kevin and others who have the architecture right but need SME fill (Sebastian for finance, Mariela for HR cert matrix, RDOs for cadence, Kevin for sister-site backups). All four are in the "structure is right, actuals owed" category - none are wrong, all are incomplete.

**10. Version History sections - PATTERN.**
PB-008 §12, PB-009 §12 (implied), PB-010 (both) §12/§13, PB-012 §12, PB-013 §11 all list Version History in the Contents but only PB-010 non-dup has a Version History block in the body. The duplicate PB-010 (1) is also missing its Version History despite listing it. This is a consistent omission across the batch - none of these PBs have proper version-history tracking in-body except PB-010 A. Should be a sweep item.
