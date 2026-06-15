# Publish Readiness - per-doc Live-gate verdict

**The "what can go online" answer the Phase 2 goal needs.**
**Compiled 2026-06-14**

Each row is a doc with a verdict: **READY** / **READY-PENDING-SME** / **NOT-READY**. The blocking item(s) for each not-ready doc are named. This is the input to Charter step 7 (Live-readiness pre-flight) and Charter step 8 (bulk catalog write + promote).

Severity scale follows REMEDIATION_WORKLIST.md numbering.

---

## 1. Already Live in the catalog (no action needed)

| # | Doc | Notes |
|---|---|---|
| 1 | SOP-002 v2.1 | Live. Has CRITICAL (TPL-017 retired-pointer) to fix in next version cut but does NOT lose Live status. |
| 2 | PB-002 v1.0 | Live. Clean. |
| 3 | PB-003 v1.1 | Live. Clean. |
| 4 | AGR-001 v1.0 (file) / v1.1 (tracker) | Live with version drift. Resolve before re-embed. |
| 5 | STD-001 v1.1 | Live. STD-001 v1.0 file is stale duplicate to remove. |
| 6 | FORM-001 v1.0 | Live. Single-page form; recommend STUB path in SousAI. |
| 7 | POSTER-001 EN+ES v1.2 | Live (visual artifact - stub path in SousAI). |
| 8 | POST-002 EN+ES v1.2 | Live (visual artifact - stub path in SousAI). |

**Count: 8 Live docs. Matches current catalog state.**

---

## 2. READY - clean and Live-ready (catalog write OK, embed OK)

Only one doc landed READY without SME dependency:

| # | Doc | Action |
|---|---|---|
| 9 | STD-001 v1.0 (stale duplicate file) | **REMOVE from library folder**, not embed. No catalog row needed (v1.1 is canonical Live). |

---

## 3. READY-PENDING-SME (gated on counsel / SLT / SME pass; no structural blocker)

These docs are substantively sound. The blockers are review signatures and the cross-batch sweeps (owner-field, terminology, restyle, Related Docs strip).

| # | Doc | Tracker Status | Blocks to Live |
|---|---|---|---|
| 10 | STD-002 v0.2 | In review | SLT signatures; INFO/SIGN catalog decision; heading restyle (currently GOOD) |
| 11 | PB-001 v9.1 | In review | SLT review; §03 PB-006 fix; rename file (drop `_not_final`); full audit beyond §01-§05 |
| 12 | POL-003 v1.1 | In review (counsel done 06/2026) | SLT publish; People Ops -> HR sweep; MLB Med Rep currency confirm |
| 13 | POL-001 | In review | Counsel sign-off; owner sweep; heading restyle; card_line + summary |
| 14 | POL-004 | In review | Counsel sign-off; Site Manager/Site Leader naming; heading restyle |
| 15 | POL-006 | In review | Counsel; APPROVED BY field; contact-routing decision (#29 remediation); heading restyle |
| 16 | POL-006-ES | In review | After POL-006 lands, ES translation goes parallel; NOT for Sous corpus |
| 17 | POL-007 | In review | Counsel pass on wage-hour / NY transparency; heading restyle |
| 18 | POL-010 | In review | Counsel review; state-specific protected classes; heading restyle |
| 19 | POL-011 | In review | Counsel review of anti-retaliation; heading restyle |
| 20 | POL-013 | In review | Counsel + FLSA review; heading restyle |
| 21 | POL-014 | In review | Counsel review; SOP-009 forward-ref decision (#11 actuals); heading restyle |
| 22 | SOP-004 | In review | Counsel review (retention, termination, suspension); owner sweep; TOC confirm; heading restyle |
| 23 | SOP-008 | In review | Britt/SLT review; TPL-018 location resolved; heading restyle (CRITICAL - longest doc in cluster) |
| 24 | SOP-012 | In review | Britt/SLT review; heading restyle |
| 25 | SOP-014 | In review | Britt/SLT review; heading restyle |
| 26 | CHK-003 | In review | Britt/SLT review; owner reconciliation; heading restyle |
| 27 | TPL-019 | In review | Britt/SLT review; sample row tag for template-as-canonical; heading restyle |
| 28 | PB-004 v1.2 | In review | Counsel review of §06/§07; owner sweep; People Ops/HR consistency; heading restyle |
| 29 | PB-004-ES | In review | After PB-004 lands; NOT for Sous corpus |
| 30 | PB-008 | In review | SLT review; §10 business continuity actuals; heading restyle |
| 31 | PB-010 (1) variant | (was Draft) | **Promote (1) to v1.1**; SLT review; heading restyle |
| 32 | PB-012 | (was Not Started; file present) | Move tracker to In Review; SLT review; §06 ABR/QBR actuals; heading restyle |
| 33 | PB-013 | (was Not Started; file present) | Move tracker to In Review; §05 cert matrix actuals (Mariela); heading restyle |
| 34 | FORM-003 | In review | SOP-004 family print-format pass; add SOP-004 to Related Documents; heading restyle |
| 35 | FORM-004 | In review | Same as #34 |
| 36 | FORM-005 | In review | Same as #34; LEGAL-REVIEW on at-will + early-term language |
| 37 | FORM-006 | In review | Same as #34 |
| 38 | FORM-007 | In review | Counsel (wage-hour interplay) |
| 39 | FORM-008 | In review | FORM-vs-AGR class decision (#56 remediation); Britt/SLT; heading restyle |

**Count: 30 READY-PENDING-SME.**

---

## 4. NOT-READY (CRITICAL blocker or substantive content gap)

These docs CANNOT promote to Live until the blocking issue is fixed.

| # | Doc | Tracker Status | Primary Blocker | Severity |
|---|---|---|---|---|
| 40 | POL-002 | In review | **Missing Related Documents block** (STD-001 §12 POL requirement) | CRITICAL-structure |
| 41 | POL-008 | In review | **State Annex does not exist on disk** - required by doc | CRITICAL-content |
| 42 | POL-009 | In review | **References POL-016 (RETIRED)** with no super | CRITICAL-retired-pointer |
| 43 | POL-015 | In review | **State Annex GAP + self-flagged FMLA worksite-coverage CRITICAL** | CRITICAL-content |
| 44 | POL-019 | In review | **§04 + §05 are explicit placeholders** (Finance compiles register; tool TBD) | CRITICAL-content |
| 45 | AGR-002 | In review | **Missing OWNER + §04 + Related Documents block** | CRITICAL-structure |
| 46 | REF-003 | In review | **No metadata block at all** + missing FORM-005 from Four Levels table | CRITICAL-structure |
| 47 | SOP-005 | Queued (file present) | **Owner field BLANK** + tracker reconciliation needed | MAJOR-blocker |
| 48 | SOP-010 | In review | **References REF-008 (RETIRED)** in §06 + Related Documents | CRITICAL-retired-pointer |
| 49 | SOP-015 | In review | **§03 power-loss temp table SAFETY-CRITICAL error** + references SOP-016 (RETIRED) | CRITICAL-safety + CRITICAL-retired |
| 50 | PB-007 | In review | **3 references to REF-008 (RETIRED)** in §02 + §14 | CRITICAL-retired-pointer |
| 51 | PB-010 (non-dup) | Draft | **"Galley is the recipe system of record" terminology drift** (corrected in (1) variant) - retire this file | CRITICAL-terminology |
| 52 | PB-009 | Not started (file present) | Move tracker; framework draft only - §07-§10 require Sebastian | MAJOR-content + tracker |
| 53 | FORM-009 | In review | **References REF-009 (RETIRED)** in body + Related Documents | CRITICAL-retired-pointer |
| 54 | REF-006 | In review | **IL state missing** + DRAFT band values pending Finance | CRITICAL-content + CRITICAL-corpus |
| 55 | REF-007 | In review | DRAFT band values pending Finance; restricted-corporate audience must be enforced | CRITICAL-corpus |
| 56 | JD TEMPLATE - Cook | (not in tracker) | No TPL-NNN ID; brand-promise drift; no STD-001 TPL anatomy | CRITICAL-multiple |
| 57 | JD TEMPLATE - Dishwasher | (not in tracker) | Same as #56 | CRITICAL-multiple |
| 58 | JD TEMPLATE - Café Attendant | (not in tracker) | Same + role-naming question | CRITICAL-multiple |
| 59 | JD TEMPLATE - Culinary Delivery Driver | (not in tracker) | Same + cross-check vs SOP-010 | CRITICAL-multiple |

**Count: 20 NOT-READY.**

---

## 5. NOT-IN-SCOPE for this audit (tracker entries with no Doc Set 1 file)

These have catalog rows planned but no on-disk content; audit cannot score:

| # | Doc | Tracker Status | Disposition |
|---|---|---|---|
| 60 | STD-003 | In review (v1.0) | Draft - SLT review pending. Not in Doc Set 1. |
| 61 | STD-004 | In review (v0.1) | Draft. Not in Doc Set 1. |
| 62 | SOP-001 | In review (v2.0 -> v2.1) | Not in Doc Set 1. Unblocks the tabled-until-August batch. |
| 63 | SOP-007 | Staged (v0.1) | Tabled until August. |
| 64 | SOP-009 | Not started | ★ MUST-HAVE per tracker. Build decision (#11 actuals). |
| 65-70 | TPL-001/002/003/004/010 | Staged | Tabled until August (depends on SOP-001 v2.1). |
| 71 | TPL-007 | Queued | Pending. |
| 72 | TPL-008 | Queued | Pending. |
| 73 | TPL-009 | Queued | Pending. |
| 74 | TPL-011 | Queued | Pending. |
| 75 | TPL-012 | Staged | Tabled until August. |
| 76 | TPL-013 | Staged | Tabled until August. |
| 77 | TPL-014 | In review (v1.0) | Tracker says Live? Locate file. |
| 78 | TPL-015 | In review (v1.0) | Locate file. |
| 79 | TPL-016 | Queued | Gated on SOP-005 / SOP-001 v2.1. |
| 80 | TPL-017 | Retired | (intranet incident log) |
| 81 | TPL-018 | In review (v1.0) | CRITICAL - locate file. Cluster dependency. |
| 82 | FORM-002 | In review (v1.0) | Live; not in Doc Set 1. Locate. |
| 83 | PB-005 | In review (v1.0) | Live; locate. |
| 84 | PB-006 | In review (Draft v0.3) | Locate. Closes Latin-cuisine identity gap. |
| 85 | PB-011 | Not started | Culinary Operations Manual. |
| 86 | PB-004-ES | In review (v1.0) | Spanish; ES corpus excluded. |
| 87 | REF-001 | Queued (v0.1) | On hold - Hartford content + counsel. |
| 88 | REF-002 | In review (v1.0) | Live; locate. |
| 89 | REF-004 | Queued | Org Chart pending. |
| 90 | REF-005-A / REF-005-B | In review (v1.0) | Live; locate. |
| 91 | POST-001 | In review (v1.2) | Live; locate file (it's referenced as already Live). |

---

## 6. Summary distribution

| Status | Count | % of Doc Set 1 |
|---|---|---|
| Already Live | 8 | 14% |
| READY (no SME) | 1 (action: remove dup) | 2% |
| READY-PENDING-SME | 30 | 53% |
| NOT-READY | 20 | 35% |
| Tracker-only (not in Doc Set 1) | 30 | n/a |

**For CK-6 Live-readiness pre-flight (Charter step 7):** the 8 already-Live docs are the gate-passers today. The +1 STD-001 v1.0 dup is a remove action. The 30 READY-PENDING-SME docs are the second wave - those promote to Live once SME blockers resolve. The 20 NOT-READY docs need substantive fixes before they can join the pre-flight pool.

**For Charter step 8 (bulk catalog write + promote):** roughly 30 doc promotions feasible after the SME passes complete. Coupled with the 8 currently-Live, that brings the catalog to ~38 Live docs - close to the content side's ~80-document target, with the remaining ~40 being Queued/Tabled/Staged catalog rows authored later.

---

## 7. Critical-path docs (Live promotion would unblock the most downstream value)

In rough priority order:

1. **PB-001 v9.1** -> Live closes Charter §5I item 1 (company-identity corpus) without any new authoring. **Highest single-doc value.**
2. **SOP-008** -> Live establishes the food-safety canon for the whole cluster (SOP-012, SOP-014, SOP-015 once fixed, CHK-003, TPL-019, FORM-008 all depend).
3. **PB-006 (Culinary OS, Draft v0.3)** - locate the file. -> Live closes Latin-cuisine identity + unblocks SLA rebuild cluster (PB-005, TPL-014, TPL-015, REF-005-A/B).
4. **STD-002 v0.2** -> Live formalizes the visual standard already in operational use for POST-001/002/003 + POSTER-001.
5. **POL-006/008/010/011/013/014/015** (bundled counsel pass) -> Live moves 7 universally-applicable people policies to operator-ready state.
6. **SOP-004** + family forms -> Live establishes the disciplinary process anchor with its implementing forms.
7. **PB-004** -> Live moves the hourly employee handbook to operator-ready (large hourly audience).
8. **AGR-001 version reconciliation** + canonical owner -> resolves the conduct anchor's drift.
9. **REF-006 / REF-007 after Finance validation** -> Live makes compensation bands authoritative.
10. **POL-019** + §04 register -> Live closes the permit/license compliance loop.

If steps 1-4 alone land, the SousAI corpus moves from 8 docs to ~14-15 docs with significantly closed gaps on company identity and food safety. That is the highest-leverage path to a substantively-different SousAI between now and CK-8.
