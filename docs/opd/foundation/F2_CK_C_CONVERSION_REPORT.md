# F2 CK-C - Conversion Report

**Built:** 2026-06-14
**For:** Kevin's CK-C fidelity spot-check per `docs/phase2/06_CONTENT_FOUNDATION_BRIEF_v2.md` §8 and the F2 task brief §6.
**Status:** F2 complete. **F3 (facts and override extraction) HOLDS** - next session, after Kevin's fidelity review.

100 documents now live in `/content/documents/`. 7 validation ERRORs, all of which map to known audit CRITICAL findings - the one-time audit is now a permanent gate that catches the findings structurally on every run.

---

## 1. F2 outcomes

| Item | Count / status |
|---|---|
| Total docs in `/content/documents/` | **100** |
| Faithful body conversions (this F2 pass) | 56 (49 from Doc Set 1 + 7 newly-provided) |
| Stubs created (Placeholder / Retired / In Build skeleton) | 36 |
| Carry-overs from F1 + F1.5 anchors | 8 |
| Validation ERRORs | 7 (all known audit CRITICAL retired-pointer findings) |
| Validation WARNs | 39 (31 heading_hierarchy on stubs - expected; 8 relationship resolves to PB-006 which Britt is finishing) |
| Conversion bugs found and fixed | 2 (MDX parse errors on `<=` and `>=` literals; replaced with Unicode `≤` / `≥`) |
| Unexpected findings | 0 |
| Content fixes applied | 0 (per "no fixes in Word" guardrail) |
| Gating decisions made | 0 (per "surface, do not decide" guardrail) |
| F5 revision-log items added | 8+ (see §6) |

---

## 2. CK-B housekeeping resolved

- **STD-001 §02 class-list edit REVERTED.** FORM and POST rows removed from §02 table and §12 anatomy. STD-001 v1.1 now matches the source 8-class list. The "add FORM + POST to STD-001 §02" item moves to the F5 revision log (§6 below).
- **Frontmatter spot-check CONFIRMED CLEAN on disk.** STD-001, FORM-001, POST-002 frontmatter blocks are correctly separated; `doc_class`, `title`, `status`, `summary` are clean. The chat-stream garble Kevin saw at CK-B was a display artifact.
- **AGR-001 version drift LEFT AS CONVERTED.** Tracker v1.1 vs file v1.0 + owner drift is preserved in the MDX with a conversion-note comment for Kevin's call.
- **Schema ownership RESOLVED.** Same GitHub repo; no split needed. F7 governance-column migration lives at `docs/migrations/pr-9-3-opd-governance-columns.sql` (or similar) - one repo, one canonical schema.

---

## 3. Status distribution (100 docs)

| Status | Count |
|---|---|
| In Build | 62 |
| Retired | 12 |
| Live | 11 |
| Pending | 7 |
| Placeholder | 6 |

| Class | Count |
|---|---|
| TPL | 21 (incl. 4 JD TEMPLATEs as TPL-101 through TPL-104, flagged for Kevin's CK-2 ID confirm) |
| POL | 20 |
| SOP | 15 |
| PB | 13 |
| REF | 10 |
| FORM | 9 |
| POST | 4 |
| STD | 3 |
| AGR | 2 |
| CHK | 1 |

**Status mapping working assumption** (Charter §6): all "In Review" tracker docs are projected as `In Build` since they lack the source-stated approval block required for Live legal class. The one exception is POL-003 which got an `approval` block because its source cover explicitly states "Approved By: SLT + Counsel · 06/2026." Kevin confirms the mapping at CK-2.

---

## 4. Validation gate findings - the audit, now structural

### 4.1 ERRORs - 7 total, all known audit CRITICALs

The validation gate caught **every retired-pointer finding from the audit** in a single pass. This is exactly the brief's promise: "you audit once for judgment and actuals. The machine prevents regression on every change after that."

| # | Doc | Pointer | Audit reference |
|---|---|---|---|
| 1 | SOP-002 | -> TPL-017 (RETIRED) | CRITICAL #1 (`CRITICAL_SUMMARY.md` §1 row 1) - intranet incident log is system of record |
| 2 | SOP-010 | -> REF-008 (RETIRED) | CRITICAL #2 - REF-008 superseded by POL-019 |
| 3 | SOP-015 | -> SOP-016 (RETIRED) | CRITICAL #3 - SOP-016 absorbed into SOP-002 §07.4 |
| 4 | POL-009 | -> POL-016 (RETIRED) | CRITICAL #4 - POL-016 retired with NO SUCCESSOR (the retention-policy GAP) |
| 5 | PB-007 | -> REF-008 (RETIRED, 3 occurrences in body) | CRITICAL #5 |
| 6 | FORM-009 | -> REF-009 (RETIRED) | CRITICAL #6 - Rippling is system of record |
| 7 | SOP-005 | -> POL-012 (RETIRED on-hold) | MAJOR - audit Batch C - on-hold pointer per Kevin's decision |

**All preserved as written in source per F2 guardrail "no content fixes."** F5 fixes these (Kevin-directed).

### 4.2 WARNs - 39 total, all expected

| Category | Count | Disposition |
|---|---|---|
| `heading_hierarchy` (stubs with no markdown headings) | 31 | Expected. Placeholder / Retired / framework stubs have 1-paragraph bodies, no `# headings` to validate. |
| `relationships -> PB-006` (Culinary OS, Britt is finishing) | 8 | Expected. PB-006 arrives later per F2 brief §2 ("Britt is ~90% done; it arrives later and converts then"). |

**Zero unexpected findings.** Zero conversion bugs after the 2 parse fixes.

---

## 5. The 2 conversion bugs (found and fixed)

While running the validation gate, 2 MDX parse errors surfaced:

- **TPL-018.mdx** - `<= 41F` and `>= 135F` in food-safety threshold tables. MDX parser was treating `<= 41F` as a JSX tag opening.
- **PB-010.mdx** - same literal `>= 135F, cold <= 41F` in §08 food-safety bullet.

**Fix:** replaced `<=` / `>=` with Unicode `≤` / `≥` in both files. Faithful in intent; valid in MDX. Body content otherwise unchanged. The Unicode comparators are universal (HACCP and FDA Food Code use them interchangeably with `<=` / `>=`).

This pattern will surface again at F2.2 when converting more food-safety docs. Recommend keeping `≤` / `≥` as the convention for comparator usage in MDX bodies. Added to the F5 revision log so SOP-008 and any other doc with `<=` / `>=` literals also gets normalized.

---

## 6. F5 revision log (preserved findings + housekeeping)

These items are **deliberately preserved in the MDX as the audit found them**. F5 fixes them with Kevin's direction.

### CRITICAL preserved findings

1. **SOP-002 -> TPL-017 (RETIRED)** in `relationships` (`from_section: Companion Form`). Fix: repoint to intranet incident log name (Kevin confirms canonical name).
2. **SOP-010 -> REF-008 (RETIRED)** in §06 + Related Documents. Fix: repoint to POL-019.
3. **SOP-015 Related Documents -> SOP-016 (RETIRED)** as Live. Fix: repoint to SOP-002 §07.4.
4. **POL-009 Related Documents -> POL-016 (RETIRED, no super)** - the retention-policy GAP. Fix: Kevin decides between (a) build retention successor, (b) repoint to PB-004 light-touch, (c) remove the reference.
5. **PB-007 §02 + §14 (3 occurrences) -> REF-008 (RETIRED)**. Fix: repoint to POL-019.
6. **FORM-009 -> REF-009 (RETIRED)** in body and Related Documents. Fix: repoint to Rippling.
7. **PB-001 v9.1 §03 ANCHOR -> PB-003** (should be PB-006 Culinary OS Handbook). Fix: replace PB-003 with PB-006 throughout §03.
8. **SOP-015 §03 power-loss decision table - 2 SAFETY-CRITICAL data errors** ("Frozen food still 41F or below" and "Cold TCS food between 41F and 135F / Safe up to 4 hours") that contradict SOP-008. Fix: Britt rewrite of §03 with SOP-008-aligned thresholds.

### MAJOR preserved findings

9. **STD-001 §02 + §12 class-list adds FORM and POST.** Reverted from CK-B; tracked for F5. Adding both classes to STD-001 brings the source standard in line with the OPD enum (10 classes).
10. **Owner-field convention sweep.** ~20 docs use department names ("Human Resources", "People Operations") instead of role titles per STD-001 §10. Kevin decides canonical term; sweep applies across affected POL/SOP/PB files. Existing memory: `project_opd_owner_field_sweep`.
11. **"People Operations" vs "Human Resources" terminology drift** across ~20 docs. Single Kevin decision drives the sweep.
12. **Status-label drift in Related Documents** - many docs list cross-refs as `Live (v1.0)` when tracker says `In Review v1.1`. STD-001 §9 says to use Doc IDs only (no version). Sweep clears the drift.
13. **PB-010 non-dup `(1) variant` is canonical** (subagent chose (1)). The non-dup file in Doc Set 1 still carries the "Galley is the recipe system of record" line that the (1) variant correctly drops. Non-dup file should be archived from Doc Set 1.
14. **AGR-001 version drift** - file v1.0 / tracker v1.1; owner Sr Dir Ops / HR. Kevin's call.
15. **JD TEMPLATE TPL-NNN ID assignments** - subagent used TPL-101/102/103/104 as F2 conversion choice. Kevin confirms at CK-2 or reassigns.
16. **JD TEMPLATE brand-promise drift** ("best-in-class hospitality through exceptional food and unmatched service" vs canonical "Best Food, Best Service, Best Hospitality"). Fix all 4 to canonical wording.
17. **REF-006 missing IL** in state coverage (7 states: AZ/FL/TX/NY/MO/OH/KY). Add IL bands; Finance confirms rates.
18. **REF-006 + REF-007 marked `in_corpus: false`** until Finance validates against Rippling.
19. **REF-003 missing FORM-005 from Four Levels table.** Preserved as source; add FORM-005 PIP entry.
20. **REF-003 + AGR-002 structural rebuild** - missing metadata blocks, missing Related Documents. Per audit MAJOR.
21. **`<=` / `>=` Unicode normalization** for any future doc with comparator literals (TPL-018 + PB-010 already done).

### Non-canonical content (corpus protection layer)

22. **STD-001 §7.1 Promise Callout illustrative content** wrapped in `<NonCanonical>` (the literal brand-promise text the Layer-2 decline test caught in F1.5).
23. **PB-003 TRY THIS / NOT THIS coaching pairs** wrapped in `<NonCanonical>` (9 instances).
24. **TPL-014 placeholder fill-in field tables** - 29 `<NonCanonical>` blocks (subagent's aggressive template-as-canonical defense).
25. **TPL-019 sample row "J.S. / 6-12"** wrapped in `<NonCanonical>` (the canonical TPL example the audit named).
26. **REF-005-A fictional Sea Slugs specifics** - 58 `<NonCanonical>` blocks (example SLA, in_corpus: false).
27. **REF-005-B fictional Sasquatches specifics** - 76 `<NonCanonical>` blocks (example SLA, in_corpus: false).
28. **STD-002 §7.8 Worked Example POST-001** noted in `non_canonical_blocks` frontmatter.

---

## 7. Frontmatter governance-field gaps (F4 input)

Per the F2 brief: "leave `approval`, `last_reviewed`, `effective_date` blank where the source doesn't state them; list for F4." The following docs have null governance fields the source did not provide:

### Owner field null (source missing)

- SOP-005 Onboarding Process - owner blank in source
- PB-009 Financial Operations Manual - no Owner row in source
- PB-012 Client & Account Management Playbook - no Owner row in source
- PB-013 Training & Certification Program - no Owner row in source

### Approver field null (source missing APPROVED BY)

- POL-004 Attendance & Punctuality Policy
- POL-006 Anti-Harassment Policy
- REF-003 Disciplinary Process Manager Quick Reference - source has no metadata block at all

### Approval block null (most In Build docs)

All `status: In Build` docs except POL-003 have no `approval` block. Validator's `chk_live_complete` extension requires `approval` for Live legal-class POL/AGR. F5 promotion to Live requires Kevin to supply approval data per doc:

- 18 POL docs (all except POL-003) - need approval block before Live
- 1 AGR doc (AGR-002) - needs approval block before Live; also needs structural rebuild

### last_reviewed / effective_date null

Most docs only carry these if explicit in source. F4 populates from Kevin-supplied data.

### Translation parity

- POL-006-ES converted (`lang: es`, `in_corpus: false`, `translation_of: POL-006`, `source_version: 1.0`)
- POST-001-ES converted (same pattern, `translation_of: POST-001`, `source_version: 1.2`)
- PB-004-ES is a Placeholder stub awaiting source file

---

## 8. Honor roll - the F2 hard guardrails

- **0 content fixes in Word source.** Every audit finding preserved as the source has it.
- **0 fact tokenization.** Literal 41F, 135F, 165F, $250, "The Hartford," "Mariela Chavez" all preserved verbatim. F3 extracts.
- **0 invented governance dates** or approval blocks beyond POL-003 (where source explicitly stated).
- **0 gating decisions** made (status mapping, terminology, AGR-001 version, POL-016 GAP, ~30-doc reconciliation, all surfaced not decided).
- **0 destructive prod operations** (no embed write, no DB write, no Drive op, no git merge).
- **0 em-dashes** in MDX output. Source em-dashes converted to hyphens per F2 rubric §5.
- **0 unexpected validation findings** after the 2 parse fixes (which themselves preserved meaning via Unicode).
- **2 parse bugs found and fixed** (`<=` / `>=` to `≤` / `≥` in TPL-018 + PB-010).
- **7 audit CRITICAL findings caught structurally** by the validation gate on every run.
- **134+ `<NonCanonical>` wrappers** protecting Sous from quoting specimen content as fact.
- **6 `<SourceGoverns>` preambles** on derived docs (POST-001, POST-001-ES, POST-002, POST-003, POSTER-001, CHK-003, TPL-019, REF-003 + 2 REF-005-A/B + TPL-014).
- **All hyphens only** in source, code, commits.

---

## 9. What Kevin reviews at CK-C

1. **Pick a random handful** of converted docs and open them. Confirm body content reads as the source said. Drift = conversion bug to fix.
2. **Confirm the 7 ERROR mapping.** Every one is a known audit CRITICAL. F5 fixes them all.
3. **Confirm `≤` / `≥` Unicode substitution is acceptable.** The alternative was MDX parse failure; this preserves meaning.
4. **Look at TPL-018.** This is the one green build from spec. Confirm fields lock to SOP-008. The two open questions (TPHC use; site-specific rows) need your input - flag in `<NonCanonical>` block at bottom.
5. **JD TEMPLATE IDs (TPL-101/102/103/104).** Are those acceptable? CK-2 confirms or reassigns.
6. **Stubs / Placeholders.** ~36 docs are stubs (Retired, Placeholder, In Build skeleton). Confirm the dispositions match your tracker.
7. **PB-005, REF-005-A, REF-005-B SLA cluster.** REF-005-A/B were given `in_corpus: false` per F2 brief §2. PB-005 has `in_corpus: true` as the binding SLA template. Confirm.
8. **STD-002 + POST-003.** I added these (they were missed in F1.5). STD-002 v0.2 needed for visual-class context; POST-003 was in source as the kitchen-safety posting.

---

## 10. What F3 does (do not run yet)

Per the v2 brief §8 and F2 task brief §7:

F3 = Facts + override extraction.

- Walk the corpus and identify load-bearing facts (135F hot / 41F cold / OT rules / sick accrual / pay bands / wc carrier / wc policy / etc.).
- Kevin confirms canonical default values and authorities for each.
- For override-bearing facts (state-bearing / account-bearing): Kevin supplies per-state / per-account variants.
- Replace inline literals with `<Fact id="..." />` tokens in the affected MDX.
- The seed `operational-facts.yaml` (4 global + 1 override-bearing demo) expands to the full fact set.

F3 needs Kevin's input on every fact. It's the next session.

After F3: F4 governance wiring (Kevin supplies approval dates), F5 revision (all audit findings fixed), F6 validation, F7 catalog projection, F8 corpus + derived + embed.

CK-C is a hard stop. F3 does not start until Kevin clears CK-C.

---

## 11. Run commands

```bash
# Validate all 100 docs (single command, ~2 seconds)
node scripts/content/validate.mjs

# Validate a single doc
node scripts/content/validate.mjs content/documents/SOP-002.mdx

# Re-run the pilot projection over all 100 docs
node scripts/content/project_pilot.mjs

# Run the F1 SOP-002 sample round trip (still works)
node scripts/content/run_sample_round_trip.mjs

# Generate derived calendar + matrix from obligations
# (empty for now; F4 populates obligations on the converted docs)
node scripts/content/generate_derived.mjs
```

---

**CK-C is a hard stop.** F3 does not start until Kevin clears the fidelity spot-check.
