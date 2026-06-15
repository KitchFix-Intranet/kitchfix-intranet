# OPD Document Review & Approval Register - Reconciliation

**Built:** 2026-06-15
**For:** Kevin's read before using the register in meetings.
**Source register:** `/Users/kevinfietek/Downloads/OPD_Review_Approval_Register.docx` (Prepared 2026-06-15, drafted from working history).
**Method:** read the register, then diffed every claim against the frontmatter of all 100 docs in `content/documents/`. Probe: `scripts/content/_probe_register_inventory.mjs` -> `.scratch/opd-audit/register-inventory.json`.

**No frontmatter changes. No edits to the Word document.** Discrepancies surfaced for Kevin to fold in.

---

## Headlines (read these first)

1. **Status counts in the register table sum to 98, not 100** (Live 11 + In Build 62 + Pending 7 + Placeholder 6 + Retired 12 = 98). The repo has 100 files. Real distribution: **Live 11, In Build 68, Pending 7, Placeholder 2, Retired 12.** The register undercounts In Build by 6 and overcounts Placeholder by 4. Most likely: the register's snapshot predates F5 status promotions (TPL-101-104 went Placeholder -> In Build at F5, plus a few others).
2. **PB-006 does not exist as a file in the repo.** The register's Section 3 (Britt) treats it as a known doc ("Roughly 90 percent built by Britt; not yet delivered"). There is no `content/documents/PB-006.mdx`. Register-correct ("it does not exist"); repo-true ("it does not exist"). The point: the register's "needs delivery" framing is accurate, but the catalog has no row for it - PB-006 also is not the Placeholder set's other slot (real Placeholders are PB-011 and STD-004).
3. **AGR-001 is Live with approval recorded today** (`approved_by: SLT + Counsel`, `approved_date: 2026-06-15`, frontmatter approval block complete). The register's Section 4 (Counsel) still lists AGR-001 as "Needs: Confirm the MLR 21 and consequence language for sign-off." This is stale - the approval got recorded as part of F5 work and the register did not catch up.
4. **The biggest cluster of discrepancies is the Counsel section.** 11 docs the register asks Counsel to sign do NOT list Counsel as an approver in frontmatter; conversely 2 docs whose frontmatter lists Counsel are NOT in the Counsel section. Per the brief, this report does not judge whether the register or the frontmatter is "right" - it just surfaces the misalignment so Kevin can decide.
5. **Britt's section omits 4 docs whose frontmatter names Director of Culinary as co-approver:** SOP-012, SOP-014, TPL-019, CHK-003. If the register intends to cover everything Britt must sign, these belong in Section 3.
6. **One Live doc has no approval block:** FORM-002. It carries `status: Live` but no `approval:` block in frontmatter. Either the frontmatter is missing the approval record or FORM-002 was promoted Live without one being captured.

The register's overall framing - foundation complete, four approver groups, build set in Section 7 - **holds up**. The misalignments are real but contained. Confidence note in Section D below.

---

## Section A - Corrections (register vs repo, per doc)

For each item: what the register says, what the frontmatter shows.

### A.1 Status counts

| Status | Register § 1 says | Repo (all 100 files) | Repo (EN only, 97) | Delta |
|---|---|---|---|---|
| Live | 11 | 11 | 10 | 0 |
| In Build | 62 | 68 | 66 | **-6** (register undercounts) |
| Pending | 7 | 7 | 7 | 0 |
| Placeholder | 6 | 2 | 2 | **+4** (register overcounts) |
| Retired | 12 | 12 | 12 | 0 |
| **Total** | **98** (text says 100) | **100** | **97** | register table -2 vs. prose claim of 100 |

Real Placeholders in repo: **PB-011** (Culinary Operations Manual), **STD-004** (Documentation Repository Standard). Both register §1's status table and the prose "100 documents" are mutually inconsistent; rebuilding the count from the inventory in §C below gives 100 exactly.

### A.2 Section 3 - Britt (Director of Culinary)

| Doc the register lists | Register claim | Frontmatter | Verdict |
|---|---|---|---|
| **SOP-015** | status implied "draft pending review", approver Director of Culinary | `status: In Build`, `approver: SLT + Director of Culinary`, `version: 1.1` | Matches register intent. |
| **PB-006** | "Roughly 90 percent built by Britt; not yet delivered" | **NO FILE EXISTS in `content/documents/`** | **Discrepancy.** Register treats as known; the catalog has no PB-006 row. Build status is correct (Britt holds the source). |
| **SOP-008** | converted faithfully; "Needs: Confirm the converted version reads correctly as the owner of record" | `status: In Build`, `approver: SLT + Director of Culinary`, `owner: Director of Culinary` | Matches. |
| **SOP-009** | grouped under Britt; "Needs: Confirm the posture statement reads correctly" | `status: In Build`, `approver: SLT`, `owner: Director of Culinary` | **Discrepancy on approver.** Owner is Director of Culinary (so Britt holds the SOP), but frontmatter approver is SLT alone - no "+ Director of Culinary." If Britt should sign, frontmatter is missing her; if SLT alone is the approver, the register is putting it under the wrong group. (Surface only - Kevin decides.) |

### A.3 Section 4 - Counsel

The register names 14+ specific docs for Counsel review. The frontmatter `approver:` field tells a different story:

| Doc register lists in §4 | Frontmatter approver | Verdict |
|---|---|---|
| POL-008 | `Counsel + SLT` | **Match** |
| POL-015 | `Counsel + SLT` | **Match** |
| POL-010 | `Counsel + SLT` | **Match** |
| POL-011 | `Counsel + SLT` | **Match** |
| POL-013 | `Counsel + SLT` | **Match** |
| POL-014 | `Counsel + SLT` | **Match** |
| AGR-001 | `SLT + Counsel` (Live; **approved today**) | **Stale in register** - already approved 2026-06-15; remove from "needs sign-off" list |
| POL-006 | **`approver: null`** (no approver listed at all) | **Discrepancy.** Register asks counsel to sign; frontmatter has no approver. Either set approver to "Counsel + SLT" or accept that universal-applicability policy doesn't need counsel. |
| POL-019 | `SLT` (no counsel) | **Discrepancy.** Register asks counsel for §04 permit register; frontmatter says SLT alone. |
| SOP-005 | `Pending - HR + SLT` (no counsel) | **Discrepancy.** Register asks counsel on E-Verify approach; frontmatter says HR + SLT pending - no counsel mentioned. |
| POL-002 | `People Operations` (no counsel, no SLT) | **Discrepancy.** Register asks counsel for "light review for legal exposure"; frontmatter assigns sign-off entirely to People Operations. |
| SOP-004 | `SLT + People Operations` (no counsel) | **Discrepancy.** Register asks counsel for retention/termination triggers; frontmatter has no counsel. |
| AGR-002 | `Senior Director of Operations` (no counsel, no SLT) | **Discrepancy.** Register groups with JD templates under counsel for legal language; frontmatter assigns to Sr Director Ops only. |
| TPL-101 | `SLT` (no counsel) | **Discrepancy.** Register asks counsel for EEO language review on JD templates; frontmatter is SLT only. |
| TPL-102 | `SLT` (no counsel) | **Same discrepancy as TPL-101.** |
| TPL-103 | `SLT` (no counsel) | **Same.** |
| TPL-104 | `SLT` (no counsel) | **Same.** |
| Records Retention | "new policy - genuine gap" | **No doc in repo** (register acknowledges). Matches register's framing. |

**Pattern:** the register's Section 4 names 11 docs under Counsel whose frontmatter does NOT name Counsel as an approver (POL-006, POL-019, SOP-005, POL-002, SOP-004, AGR-002, TPL-101, TPL-102, TPL-103, TPL-104, plus the stale AGR-001 already-signed entry). Either Kevin updates the frontmatter to add Counsel where intended, or the register's Counsel section was aspirational ("would benefit from a counsel pass") rather than reflecting the formal approver path. **Surfacing only - this is the call Kevin needs to make.**

### A.4 Section 5 - Finance (Sebastian)

| Doc register lists in §5 | Frontmatter approver | Verdict |
|---|---|---|
| REF-006 | `People Operations + Finance` | **Match** |
| REF-007 | `People Operations + Finance` | **Match** |
| POL-019 §05 (register tool) | `SLT` on POL-019 doc | Matches at the doc level (Finance is mentioned only as a co-builder for the register, not as approver) |
| PB-009 | `Accounting + SLT` | Matches (Finance = Accounting). |

Section 5 is clean.

### A.5 Section 6 - SLT

| Doc register lists in §6 | Frontmatter | Verdict |
|---|---|---|
| PB-001 | `In Build`, `version: 9.1`, `approver: SLT` | **Match.** Register's "Highest single-document value" framing checks out. |
| "In Build cluster - 62 documents" | Real In Build set is **68** docs | **Count is off by 6**, see A.1. The wave reference is the right shape; the number is stale. |
| STD-002 | `In Build`, `version: 0.2`, `approver: SLT` | **Match** including v0.2. |

### A.6 Live docs - cross-check approval blocks

The repo's 11 Live docs and their approval records:

| Live doc | Version | Approval block | approved_by |
|---|---|---|---|
| AGR-001 | 1.1 | yes | SLT + Counsel (today, 2026-06-15) |
| FORM-001 | 1.0 | yes | Senior Director of Operations |
| **FORM-002** | 1.0 | **no** | **(null)** - **discrepancy: Live without approval block** |
| PB-002 | 1.0 | yes | SLT |
| PB-003 | 1.1 | yes | SLT |
| POST-001 | 1.2 | yes | Senior Director of Operations |
| POST-001-ES | 1.2 | yes | Senior Director of Operations |
| POST-002 | 1.2 | yes | Senior Director of Operations |
| POSTER-001 | 1.2 | yes | Senior Director of Operations |
| SOP-002 | 2.1 | yes | Senior Director of Operations |
| STD-001 | 1.1 | yes | SLT |

**FORM-002 is Live but has no `approval:` block in frontmatter.** Either the block was missed when FORM-002 was promoted, or Kevin wants Live without a recorded approval for this one. Surface only.

---

## Section B - Gaps (docs that need sign-off but the register omits)

The register's Section 6 SLT wave reference ("the In Build cluster") arguably covers any In Build doc with SLT as approver. The gaps below are docs that have a SPECIFIC non-SLT-only approver (so should appear in §3/§4/§5) but are NOT named there.

### B.1 Counsel gaps (frontmatter says Counsel; register §4 doesn't name them)

| Doc | Status | Frontmatter approver | Why this matters |
|---|---|---|---|
| **POL-001** | In Build | `SLT + Counsel` | Employee Concerns Policy. Counsel co-approver per frontmatter but not in register §4. |
| **POL-003** | In Build (v1.2 after F6.5) | `SLT + Counsel` | Drug & Alcohol Policy. Approval block currently records v1.1 SLT+Counsel sign-off (2026-06-12); F6.5 wording correction needs counsel review for re-approval at 1.2. Not named in register §4. |

### B.2 Britt gaps (frontmatter says Director of Culinary; register §3 doesn't name them)

| Doc | Status | Frontmatter approver | Why this matters |
|---|---|---|---|
| **SOP-012** | In Build | `SLT + Director of Culinary` | Pest Control and IPM. Britt is co-approver. |
| **SOP-014** | In Build | `SLT + Director of Culinary` | Product Recall and Mock-Recall. Britt is co-approver. |
| **TPL-019** | In Build | `SLT + Director of Culinary` | Master Cleaning Schedule. Britt is co-approver. |
| **CHK-003** | In Build | `Pending - SLT + Director of Culinary` | Health Inspection Readiness. Pending = approver not finalized but Britt is in the pending set. |

### B.3 Null-approver gaps (frontmatter has no approver; register doesn't surface)

| Doc | Status | Frontmatter approver | Why this matters |
|---|---|---|---|
| **POL-004** | In Build | **null** | Attendance & Punctuality Policy. No approver assigned in frontmatter. Register doesn't surface as a gap. |
| **POL-006** | In Build | **null** | Register has it under Counsel (see A.3), but frontmatter is genuinely empty. |
| **POL-006-ES** | In Build | **null** | Spanish translation of POL-006. Same null. |
| (SOP-013) | Retired | null | Reserved/reusable slot - intentional, not a gap. |

### B.4 Placeholder gaps (exist in repo, register doesn't reference)

| Doc | Status | Frontmatter approver | Why this matters |
|---|---|---|---|
| **PB-011** | Placeholder | SLT | Culinary Operations Manual. Real Placeholder. Register §7 doesn't list it in the build set; not surfaced anywhere. |
| **STD-004** | Placeholder | SLT | Documentation Repository Standard. Same - not surfaced. |

(These two are the actual Placeholders that make the register's Placeholder=6 claim wrong; the 4 missing slots in the register's count are TPL-101 through TPL-104 plus likely 2 others that moved In Build at F5.)

### B.5 Pending-approver gaps (status In Build but approver starts with "Pending -")

| Doc | Status | Frontmatter approver | Why this matters |
|---|---|---|---|
| **SOP-005** | In Build | `Pending - HR + SLT` | Register puts under Counsel; frontmatter says approver not yet finalized (no counsel in the pending set). |
| **SOP-010** | In Build | `Pending - SLT` | Driver / Fleet Safety. Not named in any register section. The "Pending - " prefix means approver not finalized. |
| **CHK-003** | In Build | `Pending - SLT + Director of Culinary` | Also surfaced in B.2 above. |

### B.6 Pending-status docs

The register's status count gives 7 Pending docs. The 7 in the repo:

| Doc | Title | Approver | In register? |
|---|---|---|---|
| REF-001 | Workers Comp State Annex | Senior Director of Operations | Not by name; could be implied by Counsel state-annex bucket |
| REF-004 | Org Chart | Senior Director of Operations | Not named |
| TPL-007 | Daily Site Log | Senior Director of Operations | Not named |
| TPL-008 | Weekly Site Report | Senior Director of Operations | Not named |
| TPL-009 | Weekly RDO Rollup | VP of Operations | Not named |
| TPL-011 | Client Check-In Log | Senior Director of Operations | Not named |
| TPL-016 | Onboarding Checklist | Senior Director of Operations | Not named |

All 7 Pending docs are covered by the §6 SLT wave reference in spirit, but none is specifically called out. If Kevin wants Pending status to surface separately (so dependencies driving "Pending" get visibility), this set is the candidate list.

---

## Section C - Full inventory (authoritative per-doc table)

100 docs, columns per brief: `ID | title | doc_class | status | owner | approver | in_corpus`.

| ID | Title | Class | Status | Owner | Approver | in_corpus |
|---|---|---|---|---|---|---|
| AGR-001 | The Big Rules | AGR | Live | People Operations | SLT + Counsel | yes |
| AGR-002 | Laptop Acceptance Agreement | AGR | In Build | People Operations | Senior Director of Operations | yes |
| CHK-003 | Health Inspection Readiness | CHK | In Build | Director of Culinary | Pending - SLT + Director of Culinary | yes |
| FORM-001 | Refusal of Medical Treatment Form | FORM | Live | Director of People Operations | Senior Director of Operations | yes |
| FORM-002 | Vehicle Incident Worksheet | FORM | Live | Director of People Operations | Senior Director of Operations | yes |
| FORM-003 | Coaching & Verbal Warning Record | FORM | In Build | People Operations | Senior Director of Operations | yes |
| FORM-004 | Written Warning | FORM | In Build | People Operations | Senior Director of Operations | yes |
| FORM-005 | Performance Improvement Plan | FORM | In Build | People Operations | Senior Director of Operations | yes |
| FORM-006 | Separation Record | FORM | In Build | People Operations | Senior Director of Operations | yes |
| FORM-007 | Pay Increase Recommendation | FORM | In Build | People Operations | SLT | yes |
| FORM-008 | Health Reporting Agreement | FORM | In Build | Director of Culinary | SLT | yes |
| FORM-009 | Knife Skills Verification | FORM | In Build | Director of Culinary | SLT | yes |
| PB-001 | Leadership OS Handbook | PB | In Build | Senior Director of Operations | SLT | yes |
| PB-002 | Allergen Playbook | PB | Live | Director of Culinary | SLT | yes |
| PB-003 | Service Recovery Playbook | PB | Live | Senior Director of Operations | SLT | yes |
| PB-004 | Hourly Employee Handbook | PB | In Build | People Operations | SLT | yes |
| PB-004-ES | Hourly Employee Handbook (ES) | PB | In Build | People Operations | SLT | no |
| PB-005 | SLA OS Handbook | PB | In Build | Senior Director of Operations | SLT | yes |
| PB-007 | Workplace Safety Manual | PB | In Build | People Operations | SLT | yes |
| PB-008 | Emergency Prep & Continuity | PB | In Build | Senior Director of Operations | SLT | yes |
| PB-009 | Financial Operations Manual | PB | In Build | (null) | Accounting + SLT | yes |
| PB-010 | Site Operations Manual | PB | In Build | Senior Director of Operations | SLT | yes |
| PB-011 | Culinary Operations Manual | PB | Placeholder | Director of Culinary | SLT | no |
| PB-012 | Client & Account Management Playbook | PB | In Build | (null) | SLT | yes |
| PB-013 | Training & Certification Program | PB | In Build | (null) | HR + SLT | yes |
| POL-001 | Employee Concerns Policy | POL | In Build | People Operations | SLT + Counsel | yes |
| POL-002 | Appearance & Dress Code Policy | POL | In Build | People Operations | People Operations | yes |
| POL-003 | Drug & Alcohol Policy | POL | In Build | People Operations | SLT + Counsel | yes |
| POL-004 | Attendance & Punctuality Policy | POL | In Build | People Operations | (null) | yes |
| POL-005 | Social Media Policy | POL | Retired | People Operations | SLT + counsel | no |
| POL-006 | Anti-Harassment Policy | POL | In Build | People Operations | (null) | yes |
| POL-006-ES | Política contra el Acoso | POL | In Build | Operaciones de Personal | (null) | no |
| POL-007 | Compensation & Pay Increase Policy | POL | In Build | People Operations | SLT + People Operations | yes |
| POL-008 | Wage & Hour Policy | POL | In Build | People Operations | Counsel + SLT | yes |
| POL-009 | IT & Acceptable Use Policy | POL | In Build | Senior Director of Operations | SLT | yes |
| POL-010 | EEO, Non-Discrimination & Accommodation | POL | In Build | People Operations | Counsel + SLT | yes |
| POL-011 | Anti-Retaliation / Whistleblower | POL | In Build | People Operations | Counsel + SLT | yes |
| POL-012 | Work Authorization (I-9 / E-Verify) Policy | POL | Retired | People Operations | SLT + counsel | no |
| POL-013 | Employee Classification & Seasonal Workforce | POL | In Build | People Operations | Counsel + SLT | yes |
| POL-014 | Code of Conduct & Ethics | POL | In Build | People Operations | Counsel + SLT | yes |
| POL-015 | Leave Policies | POL | In Build | People Operations | Counsel + SLT | yes |
| POL-016 | Record Retention & Destruction | POL | Retired | People Operations | SLT + counsel | no |
| POL-017 | Paid Sick Leave Policy | POL | Retired | People Operations | SLT + counsel | no |
| POL-018 | FMLA Policy | POL | Retired | People Operations | SLT + counsel | no |
| POL-019 | Permit & License Compliance Policy | POL | In Build | Finance | SLT | yes |
| POST-001 | Incident Reporting Posting | POST | Live | Director of People Operations | Senior Director of Operations | yes |
| POST-001-ES | Reporte de Incidentes (Cartel) | POST | Live | Director of People Operations | Senior Director of Operations | no |
| POST-002 | Allergen Awareness Posting | POST | Live | Director of Culinary | Senior Director of Operations | yes |
| POST-003 | Kitchen Safety Posting | POST | In Build | Director of Culinary | Senior Director of Operations | yes |
| POSTER-001 | The Big Rules Posting | POST | Live | Director of People Operations | Senior Director of Operations | yes |
| REF-001 | Workers Comp State Annex | REF | Pending | People Operations | Senior Director of Operations | no |
| REF-002 | Uniform Standards Catalog | REF | In Build | People Operations | Senior Director of Operations | yes |
| REF-003 | Disciplinary Process Manager Quick Reference | REF | In Build | People Operations | Senior Director of Operations | yes |
| REF-004 | Org Chart | REF | Pending | Senior Director of Operations | Senior Director of Operations | no |
| REF-005-A | SLA Example - Orlando Sea Slugs Player Development Complex | REF | In Build | Senior Director of Operations | SLT | no |
| REF-005-B | SLA Example - Montana Sasquatches MLB Clubhouse | REF | In Build | Senior Director of Operations | SLT | no |
| REF-006 | Hourly Pay Bands | REF | In Build | People Operations | People Operations + Finance | no |
| REF-007 | Leadership Pay Bands | REF | In Build | People Operations | People Operations + Finance | no |
| REF-008 | Permit & License Tracker | REF | Retired | Senior Director of Operations | SLT | no |
| REF-009 | ServSafe / Cert Tracker | REF | Retired | People Operations | SLT | no |
| SOP-001 | Leadership Performance System | SOP | In Build | Senior Director of Operations | Senior Director of Operations | yes |
| SOP-002 | Safety and Incident Management | SOP | Live | Director of People Operations | Senior Director of Operations | yes |
| SOP-003 | Quality & Service Recovery Process | SOP | Retired | Senior Director of Operations | Senior Director of Operations | no |
| SOP-004 | Formal Disciplinary Process | SOP | In Build | People Operations | SLT + People Operations | yes |
| SOP-005 | Onboarding Process SOP | SOP | In Build | (null) | Pending - HR + SLT | yes |
| SOP-007 | Hourly Performance System | SOP | In Build | People Operations | Senior Director of Operations | no |
| SOP-008 | Food Safety Management | SOP | In Build | Director of Culinary | SLT + Director of Culinary | yes |
| SOP-009 | NSF Certified-for-Sport Sourcing | SOP | In Build | Director of Culinary | SLT | yes |
| SOP-010 | Driver / Fleet Safety | SOP | In Build | People Operations | Pending - SLT | yes |
| SOP-011 | OSHA 300 Recordkeeping SOP | SOP | Retired | People Operations | SLT | no |
| SOP-012 | Pest Control and IPM | SOP | In Build | Director of Culinary | SLT + Director of Culinary | yes |
| SOP-013 | (reserved - reusable) | SOP | Retired | (null) | (null) | no |
| SOP-014 | Product Recall and Mock-Recall | SOP | In Build | Director of Culinary | SLT + Director of Culinary | yes |
| SOP-015 | Emergency Food Safety | SOP | In Build | Director of Culinary | SLT + Director of Culinary | yes |
| SOP-016 | Foodborne-Illness Response SOP | SOP | Retired | Director of Culinary | SLT | no |
| STD-001 | Documentation Format Standard | STD | Live | Senior Director of Operations | SLT | yes |
| STD-002 | Visual Communication Standard | STD | In Build | Senior Director of Operations | SLT | yes |
| STD-003 | Internal Communication Standard | STD | In Build | Senior Director of Operations | SLT | yes |
| STD-004 | Documentation Repository Standard | STD | Placeholder | Senior Director of Operations | SLT | no |
| TPL-001 | Site Leader Scorecard | TPL | In Build | Senior Director of Operations | Senior Director of Operations | no |
| TPL-002 | RDO Scorecard | TPL | In Build | Senior Director of Operations | VP of Operations | no |
| TPL-003 | Cycle Performance Review (master + role addenda) | TPL | In Build | Senior Director of Operations | Senior Director of Operations | no |
| TPL-004 | 90-Day WOW Plan (master + role addenda) | TPL | In Build | Senior Director of Operations | Senior Director of Operations | no |
| TPL-007 | Daily Site Log | TPL | Pending | Senior Director of Operations | Senior Director of Operations | no |
| TPL-008 | Weekly Site Report | TPL | Pending | Senior Director of Operations | Senior Director of Operations | no |
| TPL-009 | Weekly RDO Rollup | TPL | Pending | Senior Director of Operations | VP of Operations | no |
| TPL-010 | Period-End Scorecard | TPL | In Build | Senior Director of Operations | VP of Operations | no |
| TPL-011 | Client Check-In Log | TPL | Pending | Senior Director of Operations | Senior Director of Operations | no |
| TPL-012 | Hourly Cycle Review | TPL | In Build | Senior Director of Operations | Human Resources | no |
| TPL-013 | Hourly 30-Day Check | TPL | In Build | Senior Director of Operations | Human Resources | no |
| TPL-014 | SLA Template - Blank Fill-In | TPL | In Build | Senior Director of Operations | Senior Director of Operations | yes |
| TPL-015 | Legacy SOP Intake Worksheet | TPL | In Build | Senior Director of Operations | Senior Director of Operations | yes |
| TPL-016 | Onboarding Checklist | TPL | Pending | People Operations | Senior Director of Operations | no |
| TPL-017 | Site Incident Log | TPL | Retired | Senior Director of Operations | Senior Director of Operations | no |
| TPL-018 | Daily Food Safety Log | TPL | In Build | Director of Culinary | Senior Director of Operations | yes |
| TPL-019 | Master Cleaning Schedule | TPL | In Build | Director of Culinary | SLT + Director of Culinary | yes |
| TPL-101 | Internal JD - Cook | TPL | In Build | (null) | SLT | no |
| TPL-102 | Internal JD - Dishwasher | TPL | In Build | (null) | SLT | no |
| TPL-103 | Internal JD - FOH Cafe Attendant | TPL | In Build | (null) | SLT | no |
| TPL-104 | Internal JD - Culinary Delivery Driver | TPL | In Build | (null) | SLT | no |

Counts confirmed: 100 rows; Live 11, In Build 68, Pending 7, Placeholder 2, Retired 12. Two `approver:` capitalization variants in retired docs ("SLT + counsel" vs "SLT + Counsel") - not load-bearing for sign-off (those docs are out of service) but worth a normalization sweep at F7 if you want the catalog clean.

---

## Section D - Confidence note

**The register's overall picture is sound. The misalignments are real but bounded.**

What holds up:
- The "foundation complete" framing matches the repo state (0 validation errors, 100 files converted, every audit finding closed via F5/F6/F6.5).
- The four-approver organization (Britt / Counsel / Finance / SLT) is the right shape.
- The build set in Section 7 (PB-006, PB-009, PB-012, PB-013, state annexes, records-retention) maps cleanly to the actual remaining content work.
- The SLT wave reference for the In Build cluster is the right move; the only error is the number (62 vs real 68).

What needs attention before the register goes into a meeting:
1. **Fix the status count table** (real numbers in §A.1 above).
2. **Decide the Counsel section semantically.** The register's Section 4 names 11 docs whose frontmatter does NOT list Counsel as an approver. Either (a) the register is aspirational and Kevin updates frontmatter to add Counsel to those 11, or (b) the register's Counsel section was over-scoped and some of those docs belong elsewhere. This is a Kevin-decides-it call, but the misalignment is the single biggest reconciliation item.
3. **Add the 4 Britt-touching docs** (SOP-012, SOP-014, TPL-019, CHK-003) to Section 3 if Britt should sign them.
4. **Update AGR-001's row in §4** to reflect the recorded sign-off (2026-06-15 SLT + Counsel) - already done in repo.
5. **Decide POL-001 and POL-003** for Counsel listing (both have `SLT + Counsel` in frontmatter; neither is in §4). POL-003's editorial v1.1 -> 1.2 from F6.5 (`club` -> `client` correction) is a re-approval candidate for Counsel.
6. **Acknowledge PB-006 in the catalog.** Either author a Placeholder row in `content/documents/PB-006.mdx` so the doc is tracked, or accept that PB-006 lives outside the catalog until Britt delivers.
7. **Surface PB-011 and STD-004** in Section 7 (the actual Placeholder set).
8. **FORM-002 Live without approval block** - either add the missing approval record or pull back to In Build.

None of these blocks taking the register to a meeting. They are corrections Kevin folds in, not a reason to redraft. The register can lead the conversation with the headline counts replaced by §A.1 above and the Counsel section updated per the discrepancy table in §A.3. Everything else is detail that can be cleaned up after the first round of sign-offs lands.

---

## Appendix - reruns

```bash
# Regenerate inventory + diff probe
node scripts/content/_probe_register_inventory.mjs

# Inventory JSON
cat .scratch/opd-audit/register-inventory.json | jq '.[].status' | sort | uniq -c

# Word doc extraction
python3 -c "
import zipfile
from xml.etree import ElementTree as ET
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
z = zipfile.ZipFile('/Users/kevinfietek/Downloads/OPD_Review_Approval_Register.docx')
root = ET.fromstring(z.read('word/document.xml').decode('utf-8'))
def get_text(e): return ''.join(t.text or '' for t in e.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
for child in root.find('w:body', NS):
    print(get_text(child))
"
```
