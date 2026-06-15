# Remediation Worklist - OPD Phase 2 Audit

**Every finding from Pass 1 + Pass 2 ranked by severity, each with the doc, the section, the fix, and the SME or operational actual needed.**

**Compiled 2026-06-14**

Severity scale: **CRITICAL** > **MAJOR** > **MINOR**.

Output is structured so each row is a Pass 3 work item. Use as the input to the revision queue.

---

## 1. CRITICAL items (block Live promotion or block embed)

| # | Severity | Doc | Section | Finding | Fix | SME / Actual Needed |
|---|---|---|---|---|---|---|
| 1 | CRITICAL-safety | SOP-015 | §03 power-loss decision table | "Frozen food still ≤ 41°F" row is wrong (frozen = ≤0°F or "still frozen"). "Cold TCS 41-135°F safe up to 4 hours" row conflates TPHC with general rule and would license food at ~130°F for 4 hours. Contradicts SOP-008. | Britt rewrite of §03 with SOP-008-aligned ranges and a TPHC carve-out only when monitored | Britt (Dir Culinary) |
| 2 | CRITICAL-retired | SOP-002 | Related Documents / Companion Form | TPL-017 listed as Companion Form; TPL-017 is RETIRED (intranet incident log is system of record) | Remove TPL-017 or repoint to intranet incident log | HR (Mariela) - confirm intranet log name |
| 3 | CRITICAL-retired | SOP-010 | §06 + Related Documents | REF-008 listed as Live; RETIRED | Repoint to POL-019 Permit & License Compliance Policy | none |
| 4 | CRITICAL-retired | SOP-015 | Related Documents | SOP-016 listed as Live; RETIRED (absorbed into SOP-002 §07.4) | Repoint to SOP-002 §07.4 | none |
| 5 | CRITICAL-retired | POL-009 | Related Documents | POL-016 listed as Live; RETIRED with no successor (GAP) | Kevin decision: build successor retention policy, point at PB-004 light-touch coverage, or remove the reference | Kevin |
| 6 | CRITICAL-retired | PB-007 | §02 + §14 (3 occurrences) | REF-008 listed; RETIRED | Repoint each occurrence to POL-019 | none |
| 7 | CRITICAL-retired | FORM-009 | Body line 43 + Related Documents | REF-009 referenced for training record; RETIRED (Rippling is system of record) | Repoint to Rippling | none |
| 8 | CRITICAL | PB-001 | §03 Culinary Philosophy ANCHOR | "See PB-003 Culinary OS Handbook" - PB-003 is Service Recovery; Culinary OS is PB-006 | Replace PB-003 with PB-006 throughout §03 | none |
| 9 | CRITICAL | PB-010 (non-dup) | §08 | "Galley is the recipe system of record" - violates Audit Brief §4 convention | Pick (1) variant as canonical (already drops this); retire the non-dup | none - mechanical |
| 10 | CRITICAL | REF-006 | §03 | Lists 7 states; KitchFix operates in 8. Illinois is missing. | Add IL bands. Confirm rates with Finance. | Finance (Sebastian) - IL rates |
| 11 | CRITICAL-corpus | REF-006 + REF-007 | All band values | DRAFT-tagged "pending Finance validation" - unverified estimates. Loading puts Sous in violation of hard floor rule 2 (no fabricated numbers). | Hold from SousAI corpus until Finance validates against Rippling | Finance (Sebastian) |
| 12 | CRITICAL-brand | JD TEMPLATE x4 | Brand promise line | "best-in-class hospitality through exceptional food and unmatched service" - DRIFT from canonical "Best Food, Best Service, Best Hospitality" | Fix all 4 to canonical wording | none |
| 13 | CRITICAL-structure | POL-002 | (whole doc) | No Related Documents block at end (STD-001 §12 POL requirement) | Add Related Documents block | none |
| 14 | CRITICAL-structure | AGR-002 | Metadata + §04 + end | No OWNER field; §04 missing entirely (numbering 03 -> 05); no Related Documents block | Rebuild metadata block + §04 + Related Documents block | Kevin / HR |
| 15 | CRITICAL-structure | REF-003 | Whole doc | No metadata block at all (no Owner, Approved By, Next Review, Effective); no Related Documents block; missing FORM-005 PIP from the Four Levels reference table | Full rebuild + add FORM-005 to Four Levels table | HR (Mariela) |
| 16 | CRITICAL-cleanup | (library) | STD-001 v1.0 dup | Stale duplicate file alongside canonical v1.1 | Remove `Documentation_Format_Standard_STD-001_v1.0.docx` from Doc Set 1 | none |
| 17 | CRITICAL-cleanup | (library) | PB-010 dup | Duplicate `(1)` file; (1) is more complete + corrects Galley line | Promote (1) to v1.1; retire non-dup | none |
| 18 | CRITICAL-version | AGR-001 | Cover + tracker | File = v1.0; tracker = v1.1. Owner: file = Sr Dir Ops; tracker = HR. | Kevin decision: which is canonical | Kevin |
| 19 | CRITICAL-corpus-gap | (library) | (no doc) | TPL-018 Daily Food Safety Log referenced by SOP-008, SOP-014, SOP-015, CHK-003, TPL-019 - file not in Doc Set 1 | Locate or rebuild TPL-018 | Britt / Kevin |
| 20 | CRITICAL-restyle | (43 docs) | Whole docs | FLAT-RISK chunking - no Word heading styles. Each chunks as one blob. | Heading-style restyle pass per priority tiers in `docs/phase2/05_DOC_SET_1_CHUNKING_READINESS.md` | content team |

---

## 2. MAJOR items (block Live promotion OR introduce known operational gap)

| # | Severity | Doc | Section | Finding | Fix | SME / Actual Needed |
|---|---|---|---|---|---|---|
| 21 | MAJOR | SOP-008 (and ~19 others) | Metadata Owner | "Human Resources" (department) or "People Operations" - not role title per STD-001 §10 | Owner-field sweep - decide canonical term, then sweep | Kevin - canonical term |
| 22 | MAJOR | (cross-batch) | Body throughout | "People Operations" used instead of "Human Resources" - terminology drift | Same sweep as #21 | Kevin |
| 23 | MAJOR | POL-001 | Body §02-05 | Names Mariela Chavez, Joe Lessard, Kevin Fietek inline - stale if any move | Either keep but accept maintenance debt, or point at planned REF-004 Org Chart | none |
| 24 | MAJOR | POL-001 | Whole doc | LEGAL-REVIEW: anti-retaliation language must be counsel-confirmed | Counsel | Counsel |
| 25 | MAJOR | POL-002 | §04 | "Site Manager" used; POL-004 uses "Site Leader" - terminology drift | Sweep to "Site Leader" | none |
| 26 | MAJOR | POL-003 | §10 | "People Operations (HR)" mixed usage in same doc | Single-term sweep | none |
| 27 | MAJOR | POL-003 | §09 | Dr. Bryan W. Smith MLB Medical Rep contact (336-460-1935, Bryan.Smith@mlb.com) - confirm current | Verify with MLB | MLB / Mariela |
| 28 | MAJOR | POL-006 | Metadata | No APPROVED BY field (other Batch A POLs have "Counsel + SLT") | Add APPROVED BY | Counsel signoff |
| 29 | MAJOR | POL-006 | §04 Reporting | "Contact details ... in your onboarding materials" - defers off-doc | Either inline contact path or stable doc link | Kevin |
| 30 | MAJOR | POL-008 | (whole doc) | "State Annex" named but does not exist on disk | Build State Annex per state | Counsel - 8-state research |
| 31 | MAJOR | POL-015 | §FMLA | "CRITICAL FMLA-worksite-coverage gap" self-flagged - not resolved per site | Per-site worksite-eligibility analysis (50 within 75 miles) | Counsel + HR |
| 32 | MAJOR | POL-015 | (whole doc) | Same State Annex GAP as POL-008 | Build State Annex (sick + leave) | Counsel |
| 33 | MAJOR | POL-019 | §04 + §05 | Both sections are explicit placeholders (per-site permit register; register tool TBD) | Finance compiles register; intranet/spreadsheet tool TBD | Finance |
| 34 | MAJOR | POL-006 | Metadata | Version reads "v1.0 · Draft"; other POLs read "v1.0" cleanly | Strip "Draft" once ready | none |
| 35 | MAJOR | POL-014 | §06 | References SOP-009 (NSF Certified-for-Sport) for banned-substances; SOP-009 is Not Started | Decide: build SOP-009 stub OR fold rule into POL-014 §06 in interim OR defer | Kevin |
| 36 | MAJOR | SOP-002 | Metadata Owner | "Human Resources" department; STD-001 §10 wants role title | Owner sweep | Kevin |
| 37 | MAJOR | SOP-004 | Metadata | Same owner issue. Body uses "People Operations" but Owner reads "Human Resources" - INTERNAL INCONSISTENCY | Sweep | Kevin |
| 38 | MAJOR | SOP-004 | §06 | "minimum of three years" retention - state-variable | Counsel-vetted retention schedule | Counsel |
| 39 | MAJOR | SOP-004 | §02 + §04 + §06 + §07 | LEGAL-REVIEW: suspension wage interplay, immediate-termination triggers, retention floor, review window | Counsel | Counsel |
| 40 | MAJOR | SOP-005 | Metadata | Owner BLANK | Add owner role title | Kevin |
| 41 | MAJOR | SOP-005 | §03 NOTE | References POL-012 (E-Verify, on hold) as "on hold" pointer | Kevin call: on-hold pointers acceptable in print? | Kevin |
| 42 | MAJOR | SOP-008 | Various | Multiple references to TPL-018 - file location unknown | Find TPL-018 or rebuild | Britt |
| 43 | MAJOR | PB-007 | §13 | "ServSafe and any required certifications" - no cadence / renewal interval named | Add renewal cadence | HR |
| 44 | MAJOR | PB-007 | §14 | "report within the required timeframe" vague; OSHA §1904.39 = 8hr fatality, 24hr amputation/in-patient/eye-loss | Name the specific windows | none - regulatory fact |
| 45 | MAJOR | PB-007 | §15 | "The Hartford" carrier - verify current | Confirm against current policy | Kevin / HR |
| 46 | MAJOR | PB-008 | §10 | Business continuity backups - thin spot | Specific backup specifics per account | Kevin / RDO |
| 47 | MAJOR | PB-009 | §07-§10 | Sebastian / Accounting fills needed | Finance content drop | Sebastian |
| 48 | MAJOR | PB-009 | Metadata | No Owner row | Add | Kevin |
| 49 | MAJOR | PB-012 | §06 | ABR / QBR cadence thin | Specifics from Kevin / RDO | Kevin / RDO |
| 50 | MAJOR | PB-012 | Metadata | No Owner row | Add | Kevin |
| 51 | MAJOR | PB-013 | §05 | HR cert matrix by role x state thin | HR matrix content | Mariela |
| 52 | MAJOR | PB-013 | Metadata | No Owner row | Add | Kevin |
| 53 | MAJOR | PB-001 | Filename | `_not_final` suffix breaks STD-001 §10 | Rename when finalized | none |
| 54 | MAJOR | STD-001 | §02 + §12 | Class list omits FORM and POST. OPD enum has 10 classes. | Add FORM and POST rows in §02 table + §12 anatomy | none |
| 55 | MAJOR | STD-002 | §02 vs OPD enum | Defines 4 visual classes (POST/POSTER/INFO/SIGN); OPD enum supports POST only. | Kevin call: extend enum to INFO+SIGN, OR consolidate to POST class, OR defer INFO/SIGN | Kevin |
| 56 | MAJOR | FORM-008 | Cover | Open: FORM vs AGR class question - has Acknowledgement & Agreement block | Decide: if Rippling-acknowledged, fits AGR-NNN | Kevin / Mariela |
| 57 | MAJOR | (cross-batch) | Related Documents blocks | Status-label drift - "Live (v1.0)" when tracker says In Review v1.1 | Sweep: strip version labels, use Doc ID only per STD-001 §9 | none |
| 58 | MAJOR | SOP-004 family forms | FORM-003/004/005/006 | None carry full STD-001 metadata block that FORM-007/008/009 do; older template | Print-format pass | none |
| 59 | MAJOR | SOP-004 family forms | FORM-003/004/005/006 | None reference parent SOP-004 in body or Related Documents | Add SOP-004 to Related Documents block of each | none |
| 60 | MAJOR | FORM-005 | At-will + early-term language | LEGAL-REVIEW | Counsel | Counsel |
| 61 | MAJOR | JD TEMPLATE x4 | (whole) | No TPL-NNN IDs; no STD-001 TPL anatomy; no Related Documents | Assign IDs, restyle per TPL-class anatomy | Kevin - ID assignments |
| 62 | MAJOR | JD TEMPLATE x4 | EEO language | LEGAL-REVIEW | Counsel | Counsel |
| 63 | MAJOR | JD TEMPLATE - Café | Role naming | "Café Attendant" vs REF-006 "FOH Attendant" - role-name reconciliation | Kevin call | Kevin |
| 64 | MAJOR | JD TEMPLATE - Driver | (whole) | Cross-check against SOP-010 for full hiring qualifications | Bring into alignment with SOP-010 | none |
| 65 | MAJOR | (~30 docs, tracker) | Tracker status | "Not started" / "Queued" tracker status while files exist on disk (PB-009, PB-012, PB-013, SOP-005) | Update tracker status before CK-2 catalog write | Kevin |
| 66 | MAJOR | (library-wide) | All Doc Set 1 docx | FLAT-RISK chunking on 43 of 55 docx files | Heading-style restyle pass (see priority tiers) | content team |
| 67 | MAJOR | POL-014 | Pairs with AGR-001 | Audit Brief calls for explicit AGR-001 pairing - confirmed clean | (positive confirmation - no fix) | none |

---

## 3. MINOR items (cosmetic / consistency / future-proofing)

| # | Severity | Doc | Section | Finding | Fix |
|---|---|---|---|---|---|
| 68 | MINOR | (library-wide) | Related Documents version labels | STD-001 §9 says Doc ID only; many docs list versions | Sweep |
| 69 | MINOR | PB-002 | §03.1 | "Culinary library" referenced without Doc ID | Name PB-006 |
| 70 | MINOR | PB-002 | §05.4 | Weekly allergen pre-shift topic rotation not specified | Define rotating set |
| 71 | MINOR | PB-003 | §5.3 | "SOP-004 (currently in HR + counsel review)" - dated reference | Update once SOP-004 Live |
| 72 | MINOR | AGR-001 | §03.4, §03.5, §03.8 | Three [H2] markers with no body content (formatting artifacts) | Audit doc for missing content |
| 73 | MINOR | AGR-001 | KitchFix Employee Handbook prose mention | Not by ID | Add PB-004 ID alongside |
| 74 | MINOR | STD-001 | §03 Page Architecture | Cites "v0.97 line-spacing rule added" but doc is v1.1 | Audit prose history; consider folding |
| 75 | MINOR | STD-001 | §7.1 Promise Callout example | Could be more explicit about example status | Caption beneath as "Example only" |
| 76 | MINOR | STD-002 | Cover SUPERSEDES | Names v0.1 - good, no v0.1 file on disk | (confirms v0.1 draft-only) |
| 77 | MINOR | POL-003 | Related Documents | STD-001 listed as v1.0; canonical v1.1 | Update to v1.1 or strip version |
| 78 | MINOR | POL-006 | Related Docs | SOP-004 status reads "Referenced" not "Live" / "In review" | Use consistent label |
| 79 | MINOR | POL-002 | §07 | Doesn't reference POL-013 even though seasonal terms intersect | Cross-link |
| 80 | MINOR | PB-004 | §06 Tips/Gratuity | "distributed... based on hours worked" - no formula; maybe POL-008 pointer | Add POL-008 ref if relevant |
| 81 | MINOR | PB-004 | §08 Seasonal Employment | Should reference POL-013 | Add to Related Documents |
| 82 | MINOR | POL-001 | §06 | Status of cross-refs in Related Docs uses "Live" / "In review" | Sweep |
| 83 | MINOR | TPL-019 | Sample row | "J.S." initials + date "6-12" placeholder; template-as-canonical risk | Tag as TPL class for embed-side filtering OR use explicit "[Example only]" wrapper |
| 84 | MINOR | SOP-015 | Related Documents | Missing STD-001 reference (only batch-C doc without) | Add |
| 85 | MINOR | CHK-003 | Owner | Doc says Dir Culinary; manifest says Sr Dir Ops | Resolve |
| 86 | MINOR | SOP-002 | §10 | REF-001 placeholder note should explicitly say "pending Hartford content and counsel review" | Tighten note |

---

## 4. By-SME bundling (for efficient counsel / SLT / SME passes)

### Counsel (single engagement)

POL-001, POL-002, POL-004, POL-006, POL-008, POL-009, POL-010, POL-011, POL-013, POL-014, POL-015, SOP-004 (retention + termination + suspension + review window), SOP-005, AGR-001 §08 consequences, AGR-002 + REF-003 (after structural rebuild), PB-004 §06/§07, PB-007 §15 (Hartford), POL-019 §04 placeholder, JD TEMPLATE x4 EEO + at-will. Plus per-state research for POL-008 and POL-015 state annexes.

### Director of Culinary (Britt)

SOP-008 (already in queue), SOP-012, SOP-014, SOP-015 §03 rewrite, CHK-003 owner reconciliation, TPL-019 sample-row, POST-003, PB-002 weekly topic rotation, PB-006 finalize Draft v0.3, PB-011 author, SOP-009 NSF.

### HR (Mariela)

Owner-field sweep across ~20 docs. SOP-005 owner field. REF-003 rebuild. People Ops -> Human Resources sweep. POL-001 named contacts maintenance. PB-013 cert matrix. POL-016 retention GAP decision. SOP-002 incident log canonical name. AGR-001 owner reconciliation.

### Finance (Sebastian)

REF-006 IL rates + validation. REF-007 leadership band validation. PB-009 §07-§10 authoring. POL-019 §04 register + §05 tool. PB-007 §15 Hartford verification.

### Kevin

Owner-field canonical term decision. Charter §6 status mapping. Charter §5I corpus decision (PB-001 Live + PB-006 Live closes most). STD-002 INFO/SIGN catalog handling. AGR-001 canonical version. POL-016 retention GAP. SOP-009 stub-or-defer. JD TEMPLATE x4 ID assignments + role-naming reconciliation. ~38-doc tracker reconciliation pass.

### SLT (Josh, Joe, Kevin - the publish gate)

After counsel done: POL-006, POL-008, POL-010, POL-011, POL-013, POL-014, POL-015. After Britt done: SOP-008, SOP-012, SOP-014, SOP-015 (revised), CHK-003. After all: STD-002 v0.2 promotion. PB-001 v9.1 -> Live (highest impact for SousAI corpus). PB-005 + PB-006 publish.

---

## 5. Worklist sequencing for Phase 2

If Kevin runs the work in this order, downstream items unblock at the right cadence:

1. **CK-1 decisions** (5 items: terminology, AGR-001 version, corpus gap, INFO/SIGN, retention GAP) - blocks #2-#7
2. **Tracker reconciliation** (~38 docs status updates) - blocks CK-2 catalog write
3. **CK-2 status mapping confirmation** - blocks all bulk write
4. **Heading-style restyle pass** (43 docs, Tier 1 priority) - blocks bulk embed
5. **Owner-field + People Ops -> HR sweep** - closes ~40 findings
6. **Retired-pointer fix pass** (6 docs) - closes 7 CRITICAL findings
7. **Structural rebuild pass** (POL-002, AGR-002, REF-003) - 3 NOT-READY docs become catalog-ready
8. **Counsel pass** (single engagement bundle) - unblocks 7+ POLs
9. **Britt pass** on SOP-015 §03 rewrite + TPL-018 location + SOP-008 family - clears food-safety cluster for Live
10. **Catalog write + embed** (per the engineering runbook step 8-9)
11. **CK-8 retrieval regression + verifier-step decision**
12. **PB-001 + PB-006 Live promotion** - closes Charter §5I item 1 corpus gap

Steps 1-3 + 5-6 + 9 are short-elapsed-time, big-impact. Step 8 (counsel) is the long pole. Step 4 (restyle) is parallelizable.
