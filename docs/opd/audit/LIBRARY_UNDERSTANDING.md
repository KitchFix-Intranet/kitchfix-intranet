# Library Understanding - OPD Phase 2 Pass 0

**What exists. How it connects. What is load-bearing. Where the system already looks thin or inconsistent.**

**Compiled 2026-06-14.** Pass 0 of the Charter method - read the whole library, build the picture, no edits.

This document is the Pass 0 artifact. It is the orientation a future reader needs to understand the OPD library as one interconnected system, plus the count reconciliation the Charter named as open.

---

## 1. What exists - the reconciled count

The Charter named a count question: "60 / 80 / 41 / ~80 / 91 - which is right?" The audit reconciles to:

| Source | Count | What it counts |
|---|---|---|
| Library folder (Doc Set 1) | 61 files (56 docx + 5 pdf) | What is on disk at `/Users/kevinfietek/Documents/OPD v2.0.SB/Doc Set 1` |
| Doc Set 1 distinct docs (subtract duplicates) | 57 docs | Subtract STD-001 v1.0 stale dup; subtract PB-010 (1) dup; treat POSTER-001 EN+ES as one doc; treat POST-002 EN+ES as one doc; 4 JD TEMPLATEs are present but need IDs |
| OPD `documents` table (catalog) | 42 rows | Per probe 2026-06-12 |
| Documentation Tracker v1.0 (9) "All Documents" sheet | 91 catalog entries | Includes 15 Retired + 4 Tabled-until-August + 12 Not Started + ~20 In Review + 8 Live + ~30 others |
| Effective in-scope English-only SousAI corpus candidates | ~62 docs | Excludes Retired (15), -ES translations (POL-006-ES, PB-004-ES), JD TEMPLATEs without IDs, and Not-Started docs without on-disk files |

**The "~80" Charter prose number is the count of authored / planned docs across the tracker minus the Retired / NotStarted ones.** The "61" library number is the current Doc Set 1 (with Doc Set 2 implied by the folder naming). The "42" catalog number is the present-day OPD `documents` table state.

**Kevin's CK-2 reconciliation: ~38 catalog rows are missing or status-stale.** Specifically:
- 4 docs flagged "Not Started" in tracker but with files in Doc Set 1: PB-009, PB-012, PB-013, SOP-005. Tracker status needs update to In Review.
- ~30 docs in tracker but not in Doc Set 1: SOP-001, SOP-007, TPL-001/002/003/004/007/008/009/010/011/012/013, PB-005, PB-006, REF-001/002/005-A/005-B, FORM-002, POST-001, etc. Most are Live or In Review per tracker; locate the files or confirm they live elsewhere (Doc Set 2?).
- 4 JD TEMPLATEs need TPL-NNN IDs assigned.

---

## 2. How it connects - the dependency map summary

Full graph in `DEPENDENCY_MAP.md`. Headline structure:

- **12 anchor docs** carry the most weight (≥5 inbound references each): STD-001, AGR-001, SOP-002, PB-002, SOP-001, SOP-004, PB-001, POL-001, PB-005, POL-007, POL-002, PB-004.
- **3 system anchors** (Tier 1 load-bearing): STD-001 (format anchor), SOP-002 (safety anchor), AGR-001 (conduct anchor). PB-002 is a Tier-1 anchor for allergen domain.
- **5 cluster anchors** (Tier 2): SOP-001 (leadership cycle), SOP-004 (discipline), PB-005 (SLA), PB-001 (leadership operating), POL-007 (compensation).
- **3 format/visual anchors** (Tier 3): STD-002 (visual), STD-004 (repo), STD-003 (pending).
- **6 retired-set inbound CRITICAL pointers** found in the live library - all listed in CRITICAL_SUMMARY.md §1.
- **2 well-connected islands** with no problematic isolation.
- **Multiple new orphans** from the 2026-06-12 doc cohort (CHK-003, SOP-012/014/015, PB-007/008/010, FORM-009, POL-019, SOP-010) that need reverse cross-references added to their parent docs (mostly SOP-008, PB-007, POL-019).

The library is dense and well-connected. The dependency graph is healthy in shape, with mostly tractable orphan-fixes.

---

## 3. What is load-bearing - the documents change ripples through

Documented in full in `DEPENDENCY_MAP.md` §3. Summary:

A change to any of these triggers a cascade of cross-reference work or doc updates:

- **STD-001 v1.x format updates** -> every doc legacy clause + rebuild order
- **AGR-001 vN.N** -> POSTER-001 + every PB / POL / SOP cross-ref + new acknowledgment cycle
- **SOP-002 severity tier deadline** -> POST-001 + every doc referencing the matrix
- **PB-002 allergen scope** -> POST-002 + PB-004 §05 + PB-006 + SLA examples
- **SOP-001 leadership cycle change** -> 11+ TPL implementations (TPL-001/002/003/004/010, SOP-007 mirror, TPL-007/008/009/011/012/013)
- **SOP-004 disciplinary tracks** -> 4 implementing FORMs + REF-003 + 5 referencing POLs
- **PB-005 SLA structure** -> TPL-014 (template) + TPL-015 (intake) + REF-005-A/B (examples)
- **PB-006 culinary baseline finalization** -> PB-001 §03 + PB-005 SLA cluster + REF-005-A/B examples
- **SOP-008 Live promotion** -> CHK-003, SOP-012, SOP-014, SOP-015, TPL-018, TPL-019 (single Live cohort)

The audit recommends treating SOP-008 and its 6-document satellite cluster as a single Live cohort - they need to promote together because the cross-references are tight.

---

## 4. Where it already looks thin or inconsistent

Beyond the per-doc findings in `LIBRARY_FINDINGS.md`, these are the patterns the audit surfaces:

### 4.1 Owner-field convention is broken across the library

The single most pervasive pattern. ~20 docs use department names ("Human Resources" / "People Operations") as Owner where STD-001 §10 demands a role title. The fix is one Kevin decision + one sweep. Existing memory project_opd_owner_field_sweep documents the pattern; the audit confirms it has grown since the memory was written. Recommend bundling owner-field fix with the People Ops -> Human Resources terminology sweep into a single library-wide pass.

### 4.2 The 43 FLAT-RISK docx files

The single most impactful pattern for SousAI. Per Charter §5E and the chunking probe, 43 of 55 docx files lack real Word heading styles and will each chunk as one undifferentiated blob. The 8 currently-Live docs are GOOD-structured (which is why retrieval works at 8). Every In-Review doc that needs to land Live is FLAT-RISK. The heading-style restyle pass is the single most leveraged pre-embed action. The doc list and 4-tier priority order is documented in `docs/phase2/05_DOC_SET_1_CHUNKING_READINESS.md`.

### 4.3 Counsel review backlog

Most People-Policy docs (POL-006/008/010/011/013/014/015) and several SOPs (SOP-004, SOP-005) are gated on counsel sign-off. POL-003 (Drug & Alcohol) is the model - already counsel-approved 06/2026. The audit recommends bundling the remaining POLs into a single counsel engagement. Per-state research for POL-008 and POL-015 State Annexes is the longest-tail item.

### 4.4 The 6 retired-set live pointers

CRITICAL today but fixable in a single doc-by-doc pass. Listed in `CRITICAL_SUMMARY.md` §1. Six docs (SOP-002, SOP-010, SOP-015, POL-009, PB-007, FORM-009) carry live references to 5 retired docs (TPL-017, REF-008 x2, SOP-016, POL-016, REF-009). POL-016 is the only one without a successor - that is a content GAP, not a repoint job.

### 4.5 SOP-015 §03 SAFETY-CRITICAL contradiction with SOP-008

The most operationally dangerous finding. SOP-015's power-loss decision table contradicts SOP-008's canonical 135F/41F temperature framework. A site using SOP-015's table during a power loss could leave TCS food at 130F for 4 hours believing it was safe. Britt rewrite required.

### 4.6 PB-001 §03 wrong cross-reference (renumber confusion)

PB-001 v9.1 §03 ANCHOR says "See PB-003 Culinary OS Handbook" - but PB-003 is the Service Recovery Playbook, and the Culinary OS Handbook is PB-006. The tracker flags this is a known pending renumber-confirmation issue. PB-001 is load-bearing; a wrong cross-ref here ripples.

### 4.7 PB-010 duplicate file with content drift

Two PB-010 files exist in the library. The (1) variant is more complete (17 sections vs 13) AND correctly drops the "Galley is the recipe system of record" terminology drift that the non-dup carries. Loading the non-dup into Sous would put the Galley misstatement in the corpus. Pick (1) as canonical.

### 4.8 AGR-001 version drift between file and tracker

Tracker says Live v1.1; on-disk file says v1.0. Owner differs too (file: Sr Dir Ops; tracker: HR). AGR-001 is the conduct anchor signed by every PFS employee - resolving this drift is the prerequisite to any re-embed.

### 4.9 STD-001 §02 / §12 class list is stale relative to OPD catalog enum

STD-001 lists 8 doc classes; OPD catalog enum supports 10 (adds FORM, POST). STD-001 should be updated to add FORM and POST in §02 + §12 anatomy. This drift was OK pre-OPD-schema; not OK now that catalog rows are being written.

### 4.10 STD-002 visual classes don't all fit OPD enum

STD-002 defines 4 visual classes (POST/POSTER/INFO/SIGN). OPD enum supports POST only (with POSTER prefix mapping to POST class). If new INFO or SIGN docs are authored, the catalog has no place to put them cleanly. Kevin decision is needed.

### 4.11 REF-006 + REF-007 DRAFT-tagged with unverified pay band values

Loading either into the SousAI corpus violates hard floor rule 2 (no fabricated numbers). Finance validation is the gate. Plus IL is missing from REF-006's state coverage.

### 4.12 Thin / framework-only docs in PB-009 / PB-012 / PB-013

Tracker says "Not started" but files exist (substantively framework drafts). Move tracker status to In Review and identify the SME content owners (Sebastian for Finance, Kevin / RDO for Client, Mariela for Training).

---

## 5. The Charter §5I corpus gaps - what the audit found in the library

**Item 1 - Company-identity corpus.** PB-001 v9.1 §02 contains:
- Origin (Founded on Hospitality, 2010 -> 2012)
- Mission ("We believe in the transformative power of genuine hospitality...")
- Vision ("Be the vital partner...")
- Values (Humility, Intentionality, Sustainability, Equity)
- The Promise (Best Food, Best Service, Best Hospitality)
- Pillars (Great Place to Work, Proactive vs Reactive, Growing, Profitable)
- Daily Practice (extend hospitality internally; solve before explain; earn trust)
- Non-Negotiables (Trust, The Standard, The Team, Genuine Hospitality)
- Latin-cuisine identity is referenced in PB-001 but the detail lives in PB-006 Culinary OS (Draft v0.3).

**The audit's read on Charter §5I item 1: it is NOT a new-authoring effort.** The company-identity corpus is already authored - it lives in PB-001 §02 + PB-006. Both are currently In Review. **Promoting PB-001 and PB-006 to Live closes item 1 without new authoring work.**

**Item 2 - Intranet-knowledge corpus.** Not authored. The Charter recommends a lightweight set (5-10 short docs). Kevin's call: build now or defer. Engineering posture is neutral.

---

## 6. The library's character - what KitchFix's docs sound like

This is what Sous will absorb from the corpus. The library reads:

- **Operator-first.** PB-001 §05 "How This Section Works" is exemplary - it tells the reader where the role is named at high level vs deep level. STD-001 §4.4 codifies "operator-first" as the format doctrine.
- **Confident without arrogance.** PB-002 §04 "We do not offer allergen-free meals" is a direct stance on a liability question with the reasoning attached. AGR-001 §01 names the four people the rules protect.
- **Specific.** SOP-002 §06 names exact deadlines (15 min, 30 min, 4 hr, weekly). PB-002 §02 names the Top 9 and "Anaphylaxis Four." POL-003 §08 builds the KitchFix-vs-MLB consequences table row-by-row.
- **Slightly literary.** PB-001 §02 origin story has narrative pace ("That experience set the foundation. Cook for the person, not the plate."). PB-003 §02 "A miss is not the failure. A miss without recovery is the failure." reads as doctrine.
- **Em-dashes in the print library** are intentional per STD-001 + Charter. The audit respects this; the no-em-dash rule applies to the audit OUTPUT and to Sous's voice, not the library.
- **First-person plural ("we") + active voice** throughout.
- **Banned-word discipline** is reflected in the source library (no "leverage," "utilize," "synergize," "robust") - the same banned list Sous obeys.

This is a coherent voice. The audit's recommendation when revisions happen: maintain it. A revised library that drifts to corporate-passive register erodes the brand.

---

## 7. The library's blind spots

What it never quite says:

- **What good leadership looks like under pressure** - PB-001 has the role definitions but the "what to do at 4pm when 3 things are on fire" content lives in tacit knowledge. (This is the kind of Tacit-Knowledge Gap the Intelligence Brief Pass 6 is designed to surface.)
- **The Latin-cuisine identity in depth** - referenced everywhere; lives in PB-006 which is Draft v0.3.
- **How accountability actually runs** - SOP-001 v2.1 is in review with §7 Operational Rhythm new; the live operating cadence is not yet in the library.
- **What success looks like at the site level** - TPL-001 (Site Leader Scorecard) is Tabled until August; the scoring rubric the company actually uses is not yet published.
- **Account-specific operational reality** - PB-005 SLA OS describes the structure; the real per-account reality lives in the REF-005-A/B examples + the per-account SLAs themselves (which are not in scope here).
- **Finance** - PB-009 is a framework; the actuals (food cost %, labor target, period close timing, AR/AP, billing methodology) live in Sebastian's head + the accounting tools.
- **Player-specific medical context** - intentionally absent; POL-014 §confidentiality routes this out.

---

## 8. The library's strengths

What is already very good:

- **Severity tier system (SOP-002 §04 + Notification Matrix §06)** is operational-grade. POST-001 derives correctly.
- **Allergen Playbook (PB-002)** is a model PB document. Top 9 + Anaphylaxis Four + non-negotiables + Site Leader responsibilities + 6-step response are operator-actionable at every level.
- **The Big Rules (AGR-001)** distills clubhouse conduct cleanly. The MLR 21 inclusion is correct. The signature mechanism is well-structured.
- **Drug & Alcohol Policy (POL-003)** demonstrates how a counsel-cleared POL should look: clear definitions, MLB Program coverage handled as its own track, supplements protocol with the CRITICAL callout, manager responsibilities with observable behavior list, consequences table showing parallel KitchFix + MLB tracks.
- **Service Recovery Playbook (PB-003)** is excellent coaching content. "A miss is not the failure" framing carries.
- **Food-safety cluster (SOP-008 + satellites)** is in unusually good shape for content that landed only days before the audit. Britt's authoring discipline shows.
- **Visual Communication Standard (STD-002 v0.2)** captures lessons learned from POST-001/002/003 + POSTER-001 builds, including the source-of-truth SOP cross-check, alpha-channel logo verification, phone-tree gap pattern - real operational learnings codified.

---

## 9. The single biggest leverage point for Phase 2

If only one thing is done in Phase 2 to move Sous from 8 docs to substantive coverage:

**Promote PB-001 v9.1 to Live + finalize PB-006 to Live.** That move:
1. Closes Charter §5I item 1 (company-identity corpus).
2. Closes the brand-promise blind spot Sous currently declines on.
3. Provides the leadership operating context that anchors SOP-001, SOP-007, PB-004, PB-005.
4. Unblocks PB-001 §03's PB-006 reference fix.

After that move, the food-safety cluster (SOP-008 + 6 satellites) is the next-highest leverage cohort.

After that, the People Policy cluster bundled through counsel.

After that, the SOP-004 discipline family.

This is the audit's recommended publication sequence. It is also the most efficient sequence for closing the Charter §5I corpus gap.

---

## 10. What the audit is and is not

**What this audit is:** a read-only Pass 0 + 1 + 2 across Doc Set 1 + the tracker + the system briefs, producing structured findings, dependency analysis, and a publish-readiness verdict. The artifacts are designed to be machine-usable as the input to Pass 3 (revision) and to the Charter's CK-1/CK-2 decisions.

**What this audit is not:** Pass 3 (revision). Pass 4 (re-audit after revision). Pass 5 (catalog metadata finalization). Workstream B (any technical load).

The audit STOPS at the report. The next step is Kevin reviews `CRITICAL_SUMMARY.md` (CK-3), supplies the actuals named in `ACTUALS_NEEDED.md` (or confirms deferrals), and makes the decisions named in CK-1 + CK-2. Then Pass 3 begins.
