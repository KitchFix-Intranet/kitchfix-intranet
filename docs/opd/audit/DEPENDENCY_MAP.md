# Dependency Map & Load-Bearing Register

**Audit:** OPD Library Phase 2 Pass 0
**Compiled 2026-06-14**
**Source:** Documentation Tracker `References Map` sheet + anchor-doc inline-reference reading + content briefs.
**Convention:** hyphens only, no em-dashes.

This is the dependency graph for Doc Set 1 plus the tracker's planned docs. Each edge has a referencing doc, a section in that doc, and a target doc. Edges are typed: `references`, `implements`, `supersedes`, `superseded_by`, `derived_from`, `related`. These map 1:1 to OPD `document_relationships` rows at catalog write time.

---

## 1. Edge list (machine-usable, sorted by from_doc)

| from_doc | to_doc | rel_type | from_section |
|---|---|---|---|
| AGR-001 | PB-001 | related | (referenced by) |
| AGR-001 | PB-004 | related | (referenced by) |
| AGR-001 | SOP-002 | related | (referenced by) |
| AGR-001 | LEGACY-PFS-CONF | supersedes | (legacy absorbed) |
| AGR-002 | STD-001 | related | Related Documents |
| AGR-002 | AGR-001 | related | Related Documents |
| FORM-001 | SOP-002 | implements | §7.1 + Appendix C |
| FORM-002 | SOP-002 | implements | §7.2 |
| FORM-003 | SOP-004 | implements | §02 Level 1 |
| FORM-004 | SOP-004 | implements | §02 Level 2 & 3 |
| FORM-005 | SOP-004 | implements | §03 PIP |
| FORM-006 | SOP-004 | implements | §02 Level 4 separation |
| FORM-007 | POL-007 | implements | governed by |
| FORM-007 | REF-006 | references | rate source |
| FORM-007 | REF-007 | references | rate source |
| PB-001 | STD-001 | references | Related Documents |
| PB-001 | AGR-001 | references | Related Documents |
| PB-001 | SOP-001 | references | Related Documents |
| PB-001 | PB-002 | references | Related Documents |
| PB-001 | PB-005 | references | Related Documents (v9.0 / v9.1) |
| PB-001 | PB-006 | references | §3 Culinary Philosophy (anchor) |
| PB-003 | PB-001 | references | Related Documents |
| PB-003 | AGR-001 | references | Related Documents |
| PB-003 | SOP-002 | references | §1 (out-of-scope boundary) |
| PB-003 | SOP-004 | references | §5.3 progressive action conversation |
| PB-003 | SOP-001 | references | §4.3 standard gap conversation |
| PB-003 | SOP-003 | supersedes | (retired predecessor) |
| PB-004 | AGR-001 | references | Related Documents |
| PB-004 | POL-001 | references | Related Documents (§07 Raising Concern) |
| PB-004 | POL-002 | references | Related Documents |
| PB-004 | PB-002 | references | §05 Food Safety |
| PB-004 | SOP-002 | references | Related Documents |
| PB-004 | SOP-004 | references | Related Documents |
| PB-004 | PB-004-ES | related | EN <-> ES pair |
| PB-005 | STD-001 | references | Related Documents |
| PB-005 | PB-001 | references | Related Documents |
| PB-005 | AGR-001 | references | Related Documents |
| PB-005 | PB-002 | references | Related Documents |
| PB-005 | PB-006 | references | Related Documents |
| PB-005 | SOP-001 | references | Related Documents |
| PB-005 | SOP-002 | references | Related Documents |
| POL-001 | SOP-004 | references | Related Documents |
| POL-001 | SOP-002 | references | Related Documents |
| POL-001 | PB-004 | references | Related Documents |
| POL-002 | STD-001 | references | Related Documents |
| POL-002 | AGR-001 | references | Related Documents |
| POL-002 | REF-002 | references | uniform catalog |
| POL-002 | SOP-004 | references | §06 Compliance |
| POL-004 | STD-001 | references | Related Documents |
| POL-004 | SOP-004 | references | progressive discipline |
| POL-004 | POL-001 | references | Related Documents |
| POL-004 | PB-004 | references | Related Documents |
| POL-006 | STD-001 | references | Related Documents |
| POL-006 | POL-001 | references | §04 Reporting |
| POL-006 | SOP-004 | references | Related Documents |
| POL-006 | AGR-001 | references | Related Documents |
| POL-006 | PB-004 | references | Related Documents |
| POL-006-ES | POL-006 | derived_from | translation of |
| POL-007 | REF-006 | references | Related Documents |
| POL-007 | FORM-007 | references | implementation form |
| POL-007 | SOP-004 | references | discipline tie |
| POL-007 | SOP-007 | references | hourly cycle |
| POL-007 | SOP-001 | references | leadership cycle |
| POL-007 | POL-004 | references | attendance gate |
| POL-007 | PB-004 | references | hourly audience |
| PB-004-ES | PB-004 | derived_from | Spanish companion |
| POST-001 | SOP-002 | derived_from | §4 Severity + §6 Notification source |
| POST-002 | PB-002 | derived_from | distilled from |
| POSTER-001 | AGR-001 | derived_from | distilled from |
| REF-002 | POL-002 | implements | parent policy |
| REF-003 | SOP-004 | implements | manager quick reference |
| REF-005-A | PB-005 | implements | worked PDC SLA |
| REF-005-A | PB-002 | references | implements (example) |
| REF-005-A | AGR-001 | references | implements (example) |
| REF-005-A | PB-006 | references | implements (example) |
| REF-005-B | PB-005 | implements | worked MLB SLA |
| REF-005-B | PB-002 | references | implements (example) |
| REF-005-B | AGR-001 | references | implements (example) |
| REF-005-B | PB-006 | references | implements (example) |
| REF-006 | POL-007 | references | governed by |
| SOP-001 | AGR-001 | references | §4.3 pre-Day-1 reading |
| SOP-001 | PB-002 | references | §4.3 pre-Day-1 reading |
| SOP-001 | PB-001 | references | §4.3 pre-Day-1 reading |
| SOP-001 | SOP-004 | references | §6.2 escalation |
| SOP-001 | STD-001 | references | §6.3 cross-references |
| SOP-001 | TPL-003 | references | §6.3 cross-references |
| SOP-001 | TPL-004 | references | §6.3 cross-references |
| SOP-001 | TPL-001 | references | §6.3 cross-references |
| SOP-001 | TPL-002 | references | §6.3 cross-references |
| SOP-001 | TPL-010 | references | §6.3 cross-references |
| SOP-001 | TPL-007 | references | §7 Operational Rhythm |
| SOP-001 | TPL-008 | references | §7 Operational Rhythm |
| SOP-001 | TPL-009 | references | §7 Operational Rhythm |
| SOP-001 | TPL-011 | references | §7 Operational Rhythm |
| SOP-002 | POL-001 | references | §1 + §9 |
| SOP-002 | PB-003 | references | §1 (out-of-scope) |
| SOP-002 | FORM-001 | references | §7.1 |
| SOP-002 | FORM-002 | references | §7.2 |
| SOP-002 | PB-002 | references | §7.3 |
| SOP-002 | SOP-004 | references | §8.5 |
| SOP-002 | REF-001 | references | §10 + App A |
| SOP-002 | POST-001 | references | Appendix B |
| SOP-002 | TPL-017 | references | (companion) - **BROKEN: TPL-017 is RETIRED** |
| SOP-004 | FORM-003 | references | implementing form |
| SOP-004 | FORM-004 | references | implementing form |
| SOP-004 | FORM-005 | references | implementing form |
| SOP-004 | FORM-006 | references | implementing form |
| SOP-004 | REF-003 | references | manager quick reference |
| SOP-004 | POL-001 | references | §01 Purpose & Scope |
| SOP-004 | POL-002 | references | §01 Purpose & Scope |
| SOP-004 | AGR-001 | references | §01 Purpose & Scope |
| SOP-007 | PB-004 | references | throughout |
| SOP-007 | AGR-001 | references | throughout |
| SOP-007 | PB-002 | references | throughout |
| SOP-007 | SOP-004 | references | escalation |
| STD-001 | PB-002 | references | §1 worked example |
| STD-001 | AGR-001 | references | §1 worked example |
| STD-001 | SOP-001 | references | §1 worked example |
| STD-001 | STD-002 | references | §13 sub-standard |
| STD-001 | STD-003 | references | §13 sub-standard |
| STD-002 | STD-001 | references | §1 body-doc parent |
| STD-002 | STD-003 | related | §0 reading map |
| STD-002 | PB-001 | references | Related Documents |
| STD-002 | SOP-002 | references | source for POST-001 |
| STD-002 | PB-002 | references | source for POST-002 |
| STD-002 | AGR-001 | references | source for POSTER-001 |
| STD-002 | POST-001 | references | canonical example |
| STD-002 | POST-002 | references | canonical example |
| STD-002 | POSTER-001 | references | canonical example |
| STD-003 | STD-001 | related | companion |
| STD-003 | STD-002 | related | companion |
| STD-004 | (all repo docs) | references | §0 governs SOP library repo |
| TPL-001 | SOP-001 | references | header §6.3 + §7 |
| TPL-002 | SOP-001 | references | header §6.3 + §7 |
| TPL-003 | SOP-001 | references | header §5 |
| TPL-004 | SOP-001 | references | header §4 |
| TPL-010 | SOP-001 | references | header §7 |
| TPL-012 | SOP-007 | references | header §5 |
| TPL-013 | SOP-007 | references | header §4 |
| TPL-014 | PB-005 | implements | fillable template |
| TPL-015 | TPL-014 | references | feeds |
| TPL-015 | PB-005 | references | feeds |
| TPL-015 | REF-005-A | references | feeds |
| TPL-015 | REF-005-B | references | feeds |
| TPL-017 | SOP-002 | implements | (companion log - RETIRED) |

---

## 2. In-degree ranking (most-referenced docs)

Counting inbound references from the edge list above:

| Rank | Doc | In-Degree | Role |
|---|---|---|---|
| 1 | **STD-001** Documentation Format Standard | 12 | Format anchor for the whole library |
| 2 | **AGR-001** The Big Rules | 12 | Conduct anchor; signed by every PFS employee |
| 3 | **SOP-002** Safety & Incident Management | 10 | Safety/incident anchor; severity tiers and notification matrix |
| 4 | **PB-002** Allergen Playbook | 9 | Allergen anchor; Live and embedded |
| 5 | **SOP-001** Leadership Performance System | 9 | Leadership cycle anchor (currently In Review v2.1) |
| 6 | **SOP-004** Formal Disciplinary Process | 9 | Discipline anchor (HR + counsel review) |
| 7 | **PB-001** Leadership OS Handbook | 8 | Leadership operating anchor (v9.1 In Review) |
| 8 | **POL-001** Employee Concerns Policy | 6 | HR concerns anchor |
| 9 | **PB-005** SLA OS Handbook | 5 | SLA structure anchor |
| 10 | **POL-007** Compensation Policy | 5 | Comp + bands anchor |
| 11 | **POL-002** Appearance & Dress Code | 4 | Dress code anchor (REF-002 implements) |
| 12 | **PB-004** Hourly Handbook | 7 | Hourly audience anchor |
| 13 | **PB-006** Culinary OS Handbook | 4 | Culinary baseline; gates SLA rebuilds (Draft v0.3) |

---

## 3. Load-bearing register (what flexes when X changes)

These are the **load-bearing documents**: a change in any of them ripples downstream. Audit and revision energy concentrates here.

### Tier 1 - System anchors (any change ripples wide)

**STD-001 Documentation Format Standard** (Live v1.1)
- Governs EVERY doc's format.
- A change in v1.1's typography, callout architecture, or filename convention ripples through every PB / STD / POL / SOP / TPL / CHK / REF / AGR doc.
- The v1.0 -> v1.1 fonts + palette pin already triggered rework on legacy v0.96 docs; the legacy clause in STD-001 §14 protects existing docs until their next review cycle.

**SOP-002 Safety & Incident Management** (Live v2.1)
- Severity tiers (S1-S4), notification matrix, 6-step response are the canonical source.
- POST-001 derives from §4 + §6.
- FORM-001 implements §7.1.
- FORM-002 implements §7.2.
- TPL-017 implements SOP-002 incident log - BUT TPL-017 is RETIRED. Inbound reference to retired doc.
- SOP-011 (OSHA recordkeeping) was retired and the universal §1904.39 obligation relocated to SOP-002. PB-007 §02/§14 was repointed.
- SOP-016 (foodborne illness) was retired and absorbed into SOP-002 §07.4. SOP-014, SOP-015, FORM-008 cross-refs should point at SOP-002, not SOP-016.
- A change to severity tier deadlines (e.g. S1 = 15 min) ripples to POST-001 immediately. STD-002 §13.2 source-of-truth cross-check is the guardrail.

**AGR-001 The Big Rules** (Live v1.0 on disk; tracker says v1.1)
- Confidentiality + MLR 21 + escalation chain.
- POSTER-001 derives from this.
- PB-001, PB-004, POL-006, POL-014, REF-005-A, REF-005-B all reference AGR-001.
- Absorbed LEGACY-PFS-CONF; check no live doc still points at the legacy ID.

**PB-002 Allergen Playbook** (Live v1.0)
- Top 9 allergens + "no allergen-free meals" policy + Chef-level accommodation rule.
- POST-002 derives from this.
- SOP-002 §7.3 routes allergen reaction to PB-002.
- PB-004 §05, PB-005, PB-006, REF-005-A/B all reference.

### Tier 2 - Cluster anchors

**SOP-001 Leadership Performance System** (In Review v2.0 -> v2.1)
- Anchors TPL-001/002/003/004/010/007/008/009/011/012/013 (all directly reference SOP-001 sections).
- A change to §4 (WOW Plan), §5 (Cycle Review), §6 (Escalation), §7 (Operational Rhythm) ripples to every TPL implementing it.
- Currently Tabled-until-August batch (TPL-001/002/003/004/010, SOP-007, TPL-012/013) depends on SOP-001 v2.1 finalizing.

**SOP-004 Formal Disciplinary Process** (In Review v1.0)
- Anchors FORM-003 (Level 1), FORM-004 (Levels 2 & 3), FORM-005 (PIP), FORM-006 (Separation), REF-003 (manager quick reference).
- POL-001, POL-002, POL-004, POL-007, POL-006 all route to SOP-004 for discipline.
- SOP-001 §6.2 + SOP-007 §6.2 both escalate to SOP-004.
- Counsel review required.

**PB-005 SLA OS Handbook** (In Review v1.0)
- Anchors TPL-014 (blank SLA template), TPL-015 (intake worksheet), REF-005-A/B (worked examples).
- Gated on PB-006 culinary baseline finalizing.

**PB-001 Leadership OS Handbook** (In Review v9.1)
- The leadership-system operating manual.
- Self-reference test: STD-001 §1 names PB-001 v8.1 as canonical reference build.
- Note: a "not_final" suffix is in the filename - flag.

**POL-007 Compensation Policy** (In Review v1.1)
- Anchors REF-006 (hourly bands), REF-007 (leadership bands), FORM-007 (pay increase workflow).
- Pre-Live: Counsel pass on wage-hour / NY transparency recommended.

### Tier 3 - Format/visual anchors

**STD-002 Visual Communication Standard** (In review v0.2 - just landed in Doc Set 1)
- Governs POST / POSTER / INFO / SIGN.
- POST-001, POST-002, POSTER-001 already published under it.
- POST-003 was built under STD-002 v0.2 (2026-06-12).
- A change to the layout patterns or severity color treatment ripples to every POST/POSTER artifact.

**STD-004 Documentation Repository Standard** (In review v0.1)
- §0 "Governs SOP library repo (all docs)" - meta-governance for the markdown/git library.

---

## 4. Orphans (no inbound references found)

These docs do not appear as `to_doc` anywhere in the edge list. Either truly orphan (findability dead zones) or new enough not to have been referenced yet.

| ID | Why orphan | Disposition |
|---|---|---|
| AGR-002 Laptop Acceptance Agreement | New (2026-06-08). Tracker says POL-009 should reference (IT acceptable use). | Add POL-009 -> AGR-002 reference. |
| CHK-003 Health Inspection Readiness | New (2026-06-12). Derives from SOP-008. | Add SOP-008 -> CHK-003 reference (CHK is the inspection readiness companion). |
| PB-007 Workplace Safety Manual | Built 2026-06-12. PB-008 and SOP-010 should reference as parent. | Confirm PB-008 / SOP-010 add reference in their `Related Documents`. |
| PB-008 Emergency Prep | Built 2026-06-12. Satellite of PB-007. | Same as PB-007. Plus PB-008 -> SOP-002 §07.9 + SOP-015 link present per tracker. |
| PB-009 Financial Operations Manual | Tracker says Not started but file present (FLAT-RISK). | Reconcile content state. If real content, FORM-007 and REF-006/007 should be cross-referenced. |
| PB-010 Site Operations Manual | Built 2026-06-12 (and duplicate). Points to SOP-008 per tracker. | Add reverse pointer SOP-008 -> PB-010 (Operations cross-link). |
| PB-012 Client Account Management | Tracker says Not started but file present. | Reconcile. Will reference PB-005 (SLA OS) and PB-006 (Culinary). |
| PB-013 Training & Certification | Tracker says Not started but file present. | Reconcile. Will be the master training cross-ref - touches every training-required doc. |
| POL-009 IT & Acceptable Use | New (2026-06-12). | Should reference AGR-002 (laptop). |
| POL-019 Permit & License Compliance | Replaces retired REF-008. Owner = Finance. | Add reverse: REF-008 -> POL-019 (`superseded_by`). |
| SOP-010 Driver / Fleet Safety | New (2026-06-12). PB-007 satellite. | Add PB-007 / SOP-002 -> SOP-010 references. |
| SOP-012 Pest Control | New. SOP-008 satellite. | Add SOP-008 §12 -> SOP-012 reference. |
| SOP-014 Recall & Mock-Recall | New. SOP-008 satellite. | Add SOP-008 §14 -> SOP-014 reference. |
| SOP-015 Emergency Food Safety | New. SOP-008 satellite. | Same as above. |
| TPL-018 Daily Food Safety Log | Implements SOP-008 monitoring. NOT in Doc Set 1. | Confirm location of file, add SOP-008 -> TPL-018 reference. |
| TPL-019 Master Cleaning Schedule | New. Derives from SOP-008 §10. | Add SOP-008 §10 -> TPL-019 reference. |
| FORM-009 Knife Skills Verification | New. Gates PB-007 cut-glove rule. | Add PB-007 §05/§06 -> FORM-009 reference. |

---

## 5. Islands (siloed clusters with no external pointers in either direction)

After the orphan additions above, the library is largely connected. Two islands remain:

**Compensation island.** POL-007 + REF-006 + REF-007 + FORM-007 form a tight loop with POL-004, SOP-007, SOP-001, PB-004. Well-anchored to the leadership-cycle cluster.

**Visual artifacts (POST class).** POST-001, POST-002, POST-003, POSTER-001 derive from body docs but no body doc references back to them as canonical content. This is intentional per STD-002: visuals reference the source SOP/AGR/POL, never the reverse. The body doc list of "Related Documents" should still mention them as companion postings (e.g. SOP-002 should list POST-001 as derived). The References Map confirms SOP-002 Appendix B does this for POST-001.

**No problematic islands** in this library.

---

## 6. Inbound references to the RETIRED set (CRITICAL hunt)

Each of these is a live pointer to a retired doc and counts as a CRITICAL finding for the next phase audit:

| Retired Target | Inbound From | Where | Severity |
|---|---|---|---|
| **TPL-017** Site Incident Log (retired, intranet log is system of record now) | SOP-002 | "Companion Form" per References Map | **CRITICAL** - SOP-002 Related Documents must be updated to remove TPL-017 or repoint to the intranet incident log |
| SOP-003 Quality & Service Recovery (retired, replaced by PB-003) | (no live pointers found) | - | none |
| SOP-011 OSHA 300 Recordkeeping (retired) | (PB-007 was repointed to SOP-002 per tracker) | confirm in PB-007 body | confirmed-pending-verify |
| SOP-013 (retired number) | (number reusable; no live pointers) | - | none |
| SOP-016 Foodborne-Illness (retired, absorbed into SOP-002) | tracker says SOP-014, SOP-015, FORM-008 were repointed | confirm in those bodies | confirmed-pending-verify |
| REF-008 Permit Tracker (retired, replaced by POL-019) | (no live pointers found in References Map) | - | none |
| REF-009 ServSafe Cert Tracker (retired - Rippling is system of record) | tracker says PB-007 §02/§13/§14 and FORM-009 were repointed to Rippling | confirm in those bodies | confirmed-pending-verify - subagent batches D + E to verify |
| POL-005 Social Media (Not Required - PB-004 §06 covers) | (no live pointers) | - | none |
| POL-012 Work Authorization (on hold) | (no live pointers; SOP-005 work-auth step was flagged open) | - | none-but-flag SOP-005 |
| POL-016 Record Retention (retired, no super) | POL-009 had a reference; tracker says it was removed | confirm in POL-009 body | confirmed-pending-verify |
| POL-017 Paid Sick (folded into POL-015) | (no live pointers expected) | - | none |
| POL-018 FMLA (folded into POL-015) | (no live pointers expected) | - | none |
| LEGACY-PR | (no live pointers) | - | none |
| LEGACY-WOW | (no live pointers) | - | none |
| LEGACY-PFS-CONF | absorbed by AGR-001 §02/§03/§04/§07 | - | confirmed-superseded |

**Hunt continues during Pass 1 batches.** Each subagent confirms whether their docs point to any retired ID.

---

## 7. Blast-radius pre-computation (when X changes, what flexes)

| Change Anchor | Downstream Docs | Watch For |
|---|---|---|
| STD-001 -> v1.2 (typography/palette) | Every doc | Legacy v0.96 grace period; rebuild order |
| SOP-002 §06 severity deadline change | POST-001 (already had 10/15 conflict per STD-002 §13.2) | POST-001 cross-check pre-publication |
| SOP-002 retirement of TPL-017 reference | Direct fix in SOP-002 Related Documents | **CRITICAL TODAY** - SOP-002 still lists TPL-017 |
| AGR-001 -> v1.1 (tracker says current; on-disk says v1.0) | POSTER-001 (re-cross-check), PB-001 § Related Docs, PB-004 § Related Docs, SOP-002, SOP-001, POL-006, POL-014 | **VERSION DRIFT** - tracker vs file disagreement to resolve before any catalog write |
| PB-002 v2.0 (would happen if allergen list expands) | POST-002 immediately; SOP-002 §7.3 wording; PB-004 §05; PB-006; REF-005-A/B examples | None today |
| SOP-001 v2.1 finalized | TPL-001/002/003/004/010/007/008/009/011, SOP-007, TPL-012, TPL-013 (all "Tabled until August") | Unblocks the August batch |
| PB-006 v1.0 finalized | PB-005 SLA OS, REF-005-A, REF-005-B, PB-001 §3 Culinary Philosophy | Gates SLA rebuilds (per tracker) |
| SOP-008 v1.0 -> Live | TPL-018 (log), TPL-019 (cleaning), CHK-003 (inspection), SOP-012 (pest), SOP-014 (recall), SOP-015 (emergency) | All currently In Review together; treat as a single Live cohort |
| SOP-004 v1.0 -> Live | FORM-003/004/005/006, REF-003, POL-001, POL-002, POL-004, POL-006, POL-007, POL-014 | Counsel review must complete first |
| REF-009 retirement (cert tracking -> Rippling) | PB-007 §02/§13/§14, FORM-009, SOP-005 (when authored), CHK-003, PB-013 | Verify all repointed - subagent batches will confirm |

---

## 8. Recommended `document_relationships` rows to add (orphan fixes)

These edges are not yet in the References Map but should exist per the audit. They become INSERT rows in `document_relationships` at catalog write time.

```
(SOP-008, CHK-003, references, 'SOP-008 §15 inspection readiness')
(SOP-008, SOP-012, references, 'SOP-008 §12 pest cross-ref')
(SOP-008, SOP-014, references, 'SOP-008 §14 recall cross-ref')
(SOP-008, SOP-015, references, 'SOP-008 emergency cross-ref')
(SOP-008, TPL-018, references, 'SOP-008 monitoring log')
(SOP-008, TPL-019, references, 'SOP-008 §10 cleaning schedule')
(SOP-008, PB-010, references, 'SOP-008 Operations cross-link')
(PB-007, FORM-009, references, 'PB-007 §05/§06 cut-glove gate')
(PB-007, SOP-010, references, 'PB-007 Driver Fleet satellite')
(PB-007, SOP-002, references, 'PB-007 §02/§14 injury reporting cross-link')
(PB-007, REF-009 -> Rippling, references, 'training & cert tracking - REPOINTED')
(PB-008, PB-007, references, 'PB-008 satellite of PB-007')
(PB-008, SOP-015, references, 'PB-008 utility failure cross-ref')
(POL-009, AGR-002, references, 'POL-009 IT acceptable use governs laptop AGR')
(REF-008, POL-019, superseded_by, '2026-06-12 reclassification')
(POL-005, PB-004, superseded_by, '§06 social media coverage sufficient')
(LEGACY-PFS-CONF, AGR-001, superseded_by, '§02/§03/§04/§07 absorbed')
```

---

## 9. Sub-shelves (group map per Document Inventory PNG)

From the visual inventory, the 91 catalog rows organize across 11 sub-shelves (tracker uses these; OPD schema has 7 shelves and would consolidate):

| Tracker sub-shelf | OPD shelf (per schema) | Doc count (incl. Retired) |
|---|---|---|
| Brand & Standards | Brand & Standards | 4 (STD-001, STD-002, STD-003, STD-004) |
| Safety & Incident | Safety | 9 (SOP-002, PB-002, PB-007, PB-008, SOP-010, FORM-001, FORM-002, REF-001, POST-001, POST-002, POSTER-001 - split across shelves) |
| Food Safety & Sanitation | Safety | 8 (SOP-008, SOP-012, SOP-014, SOP-015, CHK-003, TPL-018, TPL-019, FORM-008, POST-003) |
| Leadership & Performance | Operations | 11 (PB-001, SOP-001, TPL-003/004/001/002/010, SOP-007, TPL-012/013, PB-004) |
| People Policies | HR & People | 13 (POL-001 through POL-019 + retired) |
| Conduct & People Ops | HR & People | 8 (AGR-001, AGR-002, SOP-004, REF-003, FORM-003/004/005/006, POSTER-001 - split) |
| SLA & Client | Site & Client | 6 (PB-005, TPL-014, TPL-015, REF-005-A/B, PB-012) |
| Culinary | Culinary | 3 (PB-006, PB-011, SOP-009) |
| Finance | Finance | 1 (PB-009) |
| Compliance & Certification | Operations or Site&Client | 1 (POL-019) |
| Compensation | HR & People | 4 (POL-007, REF-006, REF-007, FORM-007) |
| Operations | Operations | 6 (PB-003, PB-010, TPL-007/008/009/011) |
| Training | HR & People | 1 (PB-013) |

**Reconciliation flag for Pass 5:** the tracker's 11 sub-shelves do not map 1:1 to OPD's 7 schema shelves. The audit recommends each catalog row be assigned to one of the 7 schema shelves; the tracker sub-shelf can become a `keyword` or surface tag.

---

## 10. Summary

The library is dense and connected. STD-001, AGR-001, SOP-002, and PB-002 carry the most weight. SOP-001 anchors a whole tabled-until-August cluster. SOP-008 anchors a food-safety cluster that just landed (2026-06-12) and is in tight In-Review coordination. PB-007 anchors a smaller safety satellite. PB-006 (Culinary OS) gates the SLA rebuild cluster.

**Critical findings from the dependency map alone, before per-doc scoring:**

1. **SOP-002 references TPL-017 as companion log.** TPL-017 is RETIRED. Fix in SOP-002 Related Documents.
2. **AGR-001 version drift.** Tracker says v1.1; on-disk file is v1.0. Resolve before any catalog write.
3. **PB-010 duplicate file** in library folder (`PB-010_Site_Operations_Manual_v1_0 (1).docx`). Pick canonical.
4. **STD-001 v1.0 still in library folder** alongside the canonical v1.1. Archive the v1.0.
5. **JD TEMPLATE x4** in library folder lack doc IDs - need TPL-NNN assignments.
6. **30 tracker entries have no on-disk file.** Reconciliation question for Kevin (some are Queued / Tabled / Staged; some are Live and located elsewhere).

These feed `CRITICAL_SUMMARY.md` and `REMEDIATION_WORKLIST.md` directly.
