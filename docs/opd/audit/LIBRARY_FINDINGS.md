# Library Findings - OPD Phase 2 Audit

**Pass 2 library-level checks.** Contradiction log + cross-reference integrity + terminology drift + coverage / gap map + SousAI-readiness rollup.

**Compiled 2026-06-14** from 5 subagent batches + 9 anchor scorecards + dependency map + tracker reconciliation.

---

## 1. Contradiction log (Pass 2 §6c - the highest-value exercise)

Where the library disagrees with itself on a shared operational fact. Each row: the fact, the disagreement, which is correct.

| # | Fact | Doc + Section A | Doc + Section B | Verdict | Severity |
|---|---|---|---|---|---|
| 1 | Cold-TCS temp during power loss | SOP-008 §07 (canonical: 41F danger-zone floor; 2-hr clock) | SOP-015 §03 power-loss table ("safe up to 4 hours total" in 41-135F zone) | SOP-008 wins. SOP-015 row conflates TPHC with general rule. | **CRITICAL** (safety) |
| 2 | Frozen-food threshold during power loss | SOP-008 (frozen = "still frozen") | SOP-015 §03 ("Frozen food still ≤ 41°F") | SOP-008 wins. SOP-015 conflates frozen with cold-TCS threshold. | **CRITICAL** (safety) |
| 3 | Culinary OS Handbook doc ID | Tracker: PB-006 (Draft v0.3, Britt) | PB-001 v9.1 §03 ANCHOR: "See PB-003 Culinary OS Handbook" | Tracker wins. PB-003 is Service Recovery. | **CRITICAL** |
| 4 | Recipe system of record | Audit Brief §4 convention: generic, NOT Galley | PB-010 non-dup §08: "Galley is the recipe system of record" | Convention wins. PB-010 (1) variant correctly removes this. | **CRITICAL** (terminology) |
| 5 | Site discipline / disciplinary forms used by SOP-004 | SOP-004 §03 + family forms: PIP via FORM-005 | REF-003 Four Levels table OMITS FORM-005 (PIP) | SOP-004 wins. REF-003 missing the PIP form. | MAJOR (substantive gap) |
| 6 | KitchFix operating states | Conventions list: AZ, FL, IL, KY, MO, NY, OH, TX (8 states) | REF-006 §03 lists 7 (AZ, FL, TX, NY, MO, OH, KY) - IL missing | Conventions list wins. REF-006 omits IL. | **CRITICAL** (gap) |
| 7 | Allergen accommodation authority | PB-002 §04 + ANCHOR: Chef-level decision only | (no contradicting doc) | PB-002 canonical | (clean) |
| 8 | Severity tier S1 deadline | SOP-002 §06: 15 min notification | (POST-001 v0.1 had 10 min; v1.1 corrected per STD-002 §13.2) | SOP-002 canonical. Historical conflict already resolved. | clean (per cross-check) |
| 9 | Brand promise wording | Canonical: "Best Food, Best Service, Best Hospitality" | JD TEMPLATE x4: "best-in-class hospitality through exceptional food and unmatched service" | Canonical wins. | **CRITICAL** (drift in templates) |
| 10 | OT pay (worked but unapproved) | Audit Brief §6c canonical: paid, always | POL-008 §04 explicit: worked OT always paid, unapproved is performance matter | aligned | clean |
| 11 | Sick leave accrual | Audit Brief §6c: 1hr/30, 40hr/yr floor | POL-015: 1hr/30 floor, state annex bumps up | aligned | clean |
| 12 | Full-time threshold | Audit Brief §6c: 30+ hrs | POL-013: 30+ hrs FT, <30 PT | aligned | clean |
| 13 | "People Operations" vs "Human Resources" | Conventions: HR (sweep pending) | Most POL/SOP/PB docs use "People Operations" | sweep pending - not yet decided | MAJOR (cross-batch) |

**Verdict on the contradiction hunt:** 6 CRITICAL contradictions (4 substantive + 2 brand/terminology drift), 1 MAJOR substantive gap, 1 MAJOR terminology drift, rest clean. The food-safety cluster's internal consistency is generally good (the 135/41 framework holds); SOP-015 §03 is the outlier.

---

## 2. Cross-reference integrity (Pass 2 §6b)

Every Related-Documents entry and every inline Document-ID reference must resolve to a real doc with an accurate status label.

### 2.1 Inbound pointers to RETIRED docs (any = CRITICAL)

| # | From | Section | To (RETIRED) | Fix |
|---|---|---|---|---|
| 1 | SOP-002 | Related Documents (Companion Form) | TPL-017 | Repoint to intranet incident log |
| 2 | SOP-010 | §06 + Related Documents | REF-008 | Repoint to POL-019 |
| 3 | SOP-015 | Related Documents | SOP-016 | Repoint to SOP-002 §07.4 |
| 4 | POL-009 | Related Documents | POL-016 (no super) | Kevin call: build new retention policy or remove ref |
| 5 | PB-007 | §02 + §14 (3x) | REF-008 | Repoint to POL-019 |
| 6 | FORM-009 | Body line 43 + Related Documents | REF-009 | Repoint to Rippling |

### 2.2 Status-label drift in Related Documents blocks (MAJOR, cross-batch)

Many docs list cross-references with version labels that contradict the tracker. STD-001 §9 says to cross-reference by Document ID without version (so the live current version resolves automatically). The drift is widespread:

| Referring Doc | Reference | Status label used | Tracker actual |
|---|---|---|---|
| POL-001 | STD-001 | "Live (v1.0)" | v1.1 |
| POL-001 | PB-004 | "Live (v1.0)" | In Review v1.2 |
| POL-003 | STD-001 | "Live (v1.0)" | v1.1 |
| POL-002 | Many | various "Live (vX.Y)" | mostly In Review |
| Most Batch A POLs | Several | "Live (vX.Y)" | In Review |
| SOP-004 | POL-001 | "Pending" | In Review (was reported as Pending) - acceptable |

**Single fix:** sweep all Related Documents blocks to use the convention from STD-001 §9 - Document ID + Title only, no version label (or label as "see current"). This drops the maintenance debt entirely.

### 2.3 Unresolved orphans (no inbound)

These docs have files on disk but no doc points back at them. They become findability dead zones until cross-referenced from the appropriate parent. See DEPENDENCY_MAP.md §4 for the full list. Highlights:

- AGR-002 should be in POL-009 Related Documents
- CHK-003 should be in SOP-008 Related Documents
- TPL-019 should be in SOP-008 §10
- FORM-009 should be in PB-007 §05/§06 (currently is via body prose, but Related Documents block missing)
- POL-019 should be in REF-008 superseded_by direction

### 2.4 Confirmed-clean cross-references (good news)

- PB-002 -> POST-002, SOP-002 -> POST-001, AGR-001 -> POSTER-001: all clean derivation pointers.
- SOP-004 -> FORM-003/004/005/006: clean implementation family.
- TPL-014 / TPL-015 -> PB-005 -> REF-005-A/B: clean SLA cluster.

---

## 3. Terminology consistency sweep (Pass 2 §6d)

### 3.1 "People Operations" vs "Human Resources"

**Status:** Pending sweep. Tracker / Kevin's intent is "Human Resources." Many docs use "People Operations."

| Doc | Usage |
|---|---|
| POL-001 | Owner: "People Operations"; body uses "People Operations" throughout |
| POL-002 | Owner: "People Operations" |
| POL-003 | Owner: "People Operations"; body uses both "People Operations" and "Human Resources" |
| POL-004 | "People Operations" throughout |
| POL-006 | "People Operations" |
| POL-006-ES | "Operaciones de Personal" (Spanish equivalent) |
| POL-007 | "People Operations" |
| POL-008 | "People Operations" |
| POL-010 | "People Operations" |
| POL-011 | "People Operations" |
| POL-013 | "People Operations" |
| POL-014 | "People Operations" |
| POL-015 | "People Operations" |
| POL-019 | "Finance" (different - this is Finance-owned) |
| SOP-002 | Owner "Human Resources" (department, not role); body uses "Human Resources" |
| SOP-004 | Owner "Human Resources"; body uses "People Operations" - INTERNAL INCONSISTENCY |
| SOP-005 | Owner BLANK |
| SOP-010 | Owner "Human Resources" |
| PB-004 | Owner "Human Resources"; body uses "People Operations" - INTERNAL INCONSISTENCY |
| PB-007 | Owner "Human Resources" |

**Recommendation:** Single Kevin decision drives a sweep across ~20 docs. Recommend "Human Resources" since that is the canonical brief term + the body convention in older docs.

### 3.2 "Executive Chef" vs "Site Leader"

The library uses both consistently in different contexts. Site Leader is the operational role (could be EC or GM); Executive Chef is the culinary-track role. No drift found. SOP-002 uses "Site Leader" appropriately; PB-001 §05 defines both. Clean.

### 3.3 "Galley as system of record"

Only PB-010 (non-dup) carries this. **CRITICAL** per Audit Brief §4. PB-010 (1) variant correctly drops it. Fix by promoting (1) as canonical.

### 3.4 Brand promise wording

Canonical "Best Food, Best Service, Best Hospitality" holds in PB-001 §02, PB-002, PB-003, PB-004, AGR-001 prose. JD TEMPLATE x4 DRIFT (see §1 row 9). **CRITICAL** in templates.

### 3.5 Site triad naming

PB-001 §05 names: Site Leader (EC & GM), Sous Chef, Hospitality Manager. SOP-002 §02 names: Site Leader, Manager of Record. Consistent.

### 3.6 "Site Manager" vs "Site Leader"

Batch B subagent flagged POL-002 uses "Site Manager"; POL-004 uses "Site Leader." Minor drift. Recommend canonical "Site Leader."

### 3.7 Financial model names

"Fee" model vs "full-service" model named in PB-005 (SLA OS). Not contradicted elsewhere. Clean.

---

## 4. Coverage & gap map (Pass 2 §6e)

What a professional sports contract-foodservice operation needs vs what is authored.

| Domain | Coverage status | Docs | Gaps |
|---|---|---|---|
| **Operations** | Strong | PB-001, PB-003, PB-010, TPL-007/008/009/011 | TPL-007/008/009/011 still Queued; PB-010 dup to reconcile |
| **Food Safety** | Strong (in-build) | SOP-008, SOP-012, SOP-014, SOP-015, CHK-003, TPL-018, TPL-019, FORM-008, POST-003 | SOP-015 §03 temp table CRITICAL fix; TPL-018 file location unknown |
| **HR / People** | Strong (in-build) | POL-001 through POL-015 (less retired), SOP-004, SOP-005, PB-004, AGR-001, AGR-002, FORM-003-007, REF-002, REF-003 | Counsel pass; owner-sweep; AGR-002 + REF-003 structural rebuild; POL-016 retention GAP |
| **Finance** | THIN | PB-009 (framework-only, "Not started" per tracker but file present) | All §07-§10 actuals from Sebastian; no Finance ops SOPs |
| **Culinary** | THIN | PB-002 (Live), PB-006 (Draft v0.3 - not in Doc Set 1), PB-011 (Not started), SOP-009 (Not started ★ MUST-HAVE) | SOP-009 NSF Certified-for-Sport not started; PB-006 + PB-011 culinary baseline incomplete |
| **Client / SLA** | Strong | PB-005, TPL-014, TPL-015, REF-005-A, REF-005-B, PB-012 (Not started but file present) | PB-006 dependency for SLA rebuild; PB-012 needs full content review |
| **Safety / Incident** | Strong | SOP-002, PB-002, PB-007, PB-008, SOP-010, FORM-001/002, REF-001 placeholder | REF-001 Hartford content + counsel; PB-007 + SOP-010 retired-REF-008 fixes |
| **Training** | THIN | PB-013 (Not started but file present), PB-002 ServSafe Allergen reqs, AGR-001 acknowledgment | PB-013 needs full content + role-state cert matrix from HR |
| **Brand** | Strong | STD-001, STD-002 (just landed) | STD-003 still pending; STD-004 still in review |
| **Company Identity** | EMERGING | PB-001 §02 (Mission/Vision/Values/Promise/Pillars/Daily Practice) | PB-001 In Review v9.1 with `_not_final` suffix; needs Live promotion to close Charter §5I gap |
| **Intranet knowledge** | NOT STARTED | (no docs) | Charter §5I item 2: lightweight set of "how to use page X / tool Y" descriptions. Kevin decision needed. |

### 4.1 The two Charter §5I gaps

**Item 1 - Company-identity corpus.** PB-001 §02 has the brand promise, mission, vision, values, pillars, daily practice, non-negotiables - this IS the company-identity content Sous needs. PB-006 (Culinary OS Handbook, Draft v0.3) carries the Latin-cuisine identity. **Recommendation: not a separate authoring effort - finalize PB-001 to Live (currently In Review v9.1) + finalize PB-006 (Draft v0.3 -> v1.0).** Promoting these two closes the corpus gap without new authoring.

**Item 2 - Intranet-knowledge docs.** None authored. Kevin decision needed. Recommend Charter §5I "lightweight set" - 5-10 short docs (one per major intranet tool: Build Dashboard, Sous Demo, Incident Center, Inventory Manager, Review Queue, People Portal, Drive sharing, etc.). Could be Phase 2 or deferred.

---

## 5. SousAI-readiness library rollup (Pass 2 §6f)

### 5.1 Template-as-canonical risk inventory (hard floor rule 7)

Docs containing example, specimen, or fill-in content Sous could retrieve as canonical:

| Doc | Risk | Mitigation |
|---|---|---|
| STD-001 §7.1 Promise Callout example | The example contains literal brand-promise text. Already triggered the correct Sous decline in regression testing. | Caption the example as illustrative |
| STD-001 §7.2 Anchor Banner / §7.3 Critical / §7.4 Note callouts | Example body text inside each callout shape | Caption as illustrative |
| STD-002 §7.8 Worked Example POST-001 | Walks through an artifact build | Already framed as Example |
| All TPL-class docs (TPL-019, TPL-014, TPL-015, JD TEMPLATEs) | Sample rows + placeholder values | Tag as TPL class so embed-side filtering can exclude or wrap; example rows like "J.S. / 6-12" in TPL-019 are direct risk |
| REF-006 / REF-007 pay bands | DRAFT-tagged unverified estimates | Hold from corpus until Finance validation |

### 5.2 Chunking-readiness library rollup

Per Charter §5E and the docx probe (`docs/phase2/05_DOC_SET_1_CHUNKING_READINESS.md`):

- 8 docs are GOOD (real Heading styles): STD-001 (both versions), STD-002 v0.2, SOP-002, PB-001, PB-002, PB-003, AGR-001, POL-003
- 4 are THIN (Title-only): JD TEMPLATE x4
- 43 are FLAT-RISK: all other docx files. Each will chunk as one undifferentiated blob.

**Library-wide observation:** The 8 Live docs that are well-structured ARE the 8 docs currently embedded. Every In-Review doc that needs to land Live in Phase 2 is FLAT-RISK. **The heading-style restyle pass is the single most important pre-embed prerequisite for everything except the existing Live cohort.**

### 5.3 Number hygiene inventory

Docs with figures, dates, or dollars that need verification before Sous can quote:

| Doc | Numbers to verify |
|---|---|
| REF-006 | Hourly pay bands across 7 states (IL missing) - DRAFT/unverified |
| REF-007 | Leadership pay bands - DRAFT/unverified |
| POL-003 §09 | MLB Medical Rep contact (Dr. Bryan W. Smith, 336-460-1935, Bryan.Smith@mlb.com) - confirm currency |
| SOP-002 §10 | The Hartford policy number "83 WEC BP9792" - confirm currency |
| SOP-008 various | Specific Food Code citations (FDA Food Code §3-401.11 etc.) - confirm currency post-2025 update if applicable |
| POL-008 | BAC 0.08% (federal standard - correct) |
| TPL-019 | Example initials "J.S." + date "6-12" in sample row - template-as-canonical risk |
| POL-007 / POL-015 | Cap rates, hours, accrual amounts - per-state annexes |

---

## 6. Governance / publish-readiness (Pass 2 §6f)

Per-doc Live-gate verdict is in `PUBLISH_READINESS.md`. Summary distribution:

- **Already Live** (8): SOP-002, PB-002, PB-003, AGR-001 (with version drift to resolve), STD-001 v1.1, POST-001, POST-002, POSTER-001 - plus FORM-001 (Live per tracker; stub-path recommended for Sous)
- **READY (no SME blocker)** (1): STD-001 v1.0 dup - **REMOVE** action
- **READY-PENDING-SME** (~30): mostly counsel-gated POLs + SLT-pending SOPs / TPLs / PBs
- **NOT-READY** (~13): structural rebuilds or CRITICAL-blocker fixes - POL-002, POL-008, POL-015, POL-019, POL-009, AGR-002, REF-003, SOP-005, SOP-010, SOP-015, PB-007, PB-010 non-dup, PB-009, FORM-009, REF-006, REF-007, JD TEMPLATE x4

---

## 7. Patterns to fix once (single sweeps that close many findings)

1. **Owner-field role-title sweep.** ~20 docs. Decide canonical term ("Human Resources"), then sweep. Closes ~20 MAJOR findings.
2. **People Operations -> Human Resources term sweep.** Same 20 docs body text. Closes ~20 MAJOR findings.
3. **Related Documents version-label strip.** Use Document ID only. Closes ~15-20 MINOR findings across the library.
4. **Heading-style restyle pass.** 43 FLAT-RISK docs. The doc-list and priority tiers are in `docs/phase2/05_DOC_SET_1_CHUNKING_READINESS.md`. Closes the single biggest SousAI-readiness blocker.
5. **Retired-set pointer fix pass.** 6 docs (SOP-002, SOP-010, SOP-015, POL-009, PB-007, FORM-009). Repoint each per §2.1 above.
6. **Counsel review pass on the POL cluster.** Bundle POL-006, POL-008, POL-010, POL-011, POL-013, POL-014, POL-015 (POL-003 already counsel-done) into one counsel engagement.

---

## 8. The audit's "what the library says, implies, and omits"

- **SAYS** Best Food, Best Service, Best Hospitality. Says consistently across PB-001, PB-002, PB-003, PB-004, AGR-001. Brand promise carries.
- **SAYS** 135F hot / 41F cold throughout food-safety cluster.
- **SAYS** Owner = Human Resources / People Operations (the drift the sweep resolves).
- **IMPLIES** that all references resolve - they mostly do, except the 6 retired-pointer breaks above.
- **IMPLIES** that REF-006 + REF-007 are usable references - they are not yet (DRAFT estimates).
- **OMITS** retention policy (POL-016 retired, no successor).
- **OMITS** SOP-009 NSF Certified-for-Sport - cited forward by POL-014; ★ MUST-HAVE per tracker but Not Started.
- **OMITS** PB-011 Culinary Operations Manual + PB-013 Training & Cert + PB-009 Finance Manual - all flagged Not Started in tracker but have files (audit found content). Move to In Review at CK-2.
- **OMITS** intranet-knowledge corpus (Charter §5I item 2).
- **OMITS** IL state coverage in REF-006.
- **OMITS** TPL-018 location (referenced by 5 docs but not in Doc Set 1).
