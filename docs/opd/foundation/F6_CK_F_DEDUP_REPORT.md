# F6 CK-F - Validation + Duplicate Sweep + HR-Mentions + Relationship Graph

**Built:** 2026-06-15
**For:** Kevin's CK-F spot-check per `docs/phase2/06_CONTENT_FOUNDATION_BRIEF_v2.md` §8 and the F6 task brief.
**Status:** F6 complete. **NO content changes** were made - this is the surface-and-propose pass per brief.

F5 cleared the validation gate (7 -> 0 ERRORs). F6 confirms that gate held, surfaces duplication risk, lists remaining "Human Resources" body mentions for a uniform sweep decision, and proposes orphan + missing-edge fixes. Every item ends at "Kevin decides."

---

## 0. Bottom line up front

| Item | Result |
|---|---|
| Validation gate | **0 ERRORs**, 40 WARNs (all baseline - 31 stub heading_hierarchy + 9 PB-006 cross-refs) |
| Doc-pair similarity (real, non-stub, non-boilerplate) | **1 pair** (REF-006 / REF-007 at 0.172) |
| Passage-level similarity (real content, not Related Documents tables) | **2 pairs** (POL-003 §06 / SOP-009 §03; POST-001 / SOP-002 §04) |
| Intentional duplication left alone | JD templates (TPL-101-104), example SLAs (REF-005-A/B), Related Documents tables, frontmatter-only stubs, SourceGoverns-prefaced distillations |
| Remaining "Human Resources" body mentions | **28 mentions across 11 docs** - all candidates for People Operations sweep |
| Orphan docs (non-Retired, non-Placeholder) | 11 (translations, JD templates, intake worksheet, REF-004 pending) |
| Missing-edge proposals | 21 substantive (excluding 18 from stubs whose bodies are placeholder text) |

**No surprises.** The two real content overlaps are surgical - both have a clear single-sourcing path that does NOT require rewriting either doc.

---

## 1. Validation re-confirm

Ran `node scripts/content/validate.mjs` post-F5. Result identical to the F5 close-out:

```
ERRORS: 0
WARNS:  40
  - 31 heading_hierarchy WARNs (frontmatter-only stubs - they have no body headings by design)
  - 9 PB-006 cross-references WARN (PB-006 is referenced by ~9 docs but is still In Build / Placeholder)
```

Both WARN categories are expected baseline:
- **Stub WARNs** clear when each stub gets a body in F7+/F8 build-out passes.
- **PB-006 WARNs** clear when PB-006 promotes from Placeholder to Live (PB-006 is the Culinary OS Handbook; build is scoped post-foundation).

No regression from F5. Gate is green.

---

## 2. Duplicate sweep

### 2.1 Method

Built `scripts/content/_probe_dedup_sweep.mjs` (node-native, no new deps). For each doc body:

1. Strip frontmatter, `<Fact>`, `<NonCanonical>`, `<Include>`, `<SourceGoverns>`, table syntax, code, links, emphasis, punctuation.
2. Lowercase + collapse whitespace.
3. Generate 5-gram shingles.
4. Compute Jaccard similarity pairwise.

Two outputs: whole-doc pair similarity (threshold 0.15) and per-section passage similarity (threshold 0.35, min passage 200 chars). Full ranked JSON written to `.scratch/opd-audit/f6-dedup-sweep.json`.

Per the F6 brief, the bar is **drift-prone duplication, not duplication itself**. Identical-by-design boilerplate gets a "left alone" categorization, not a flag.

### 2.2 Doc-pair findings (real content)

After filtering intentional pairs (JD templates, example SLA companions) and stub-vs-stub noise (Placeholder/Retired bodies share generic frontmatter-only stub language):

| Score | Pair | Read | Proposed disposition |
|---|---|---|---|
| 0.172 | **REF-006 / REF-007** | Hourly pay-band reference and Leadership pay-band reference. Both have `in_corpus: false` until Finance validates against Rippling. Overlap is the framing language (per-state column headers, the "values are draft" preface, the audience scope note). | **Leave alone.** Companion docs with identical scaffolding are normal. Both stay `non_canonical: true` via `pay_band_hourly` / `pay_band_leadership` facts. When they promote to corpus, the framing language can be `<Include>`-d from one canonical preface block - record as F7 polish item, not F6 fix. |

That is the entire list of cross-doc similarity worth surfacing. Every other above-threshold pair is intentional (next section).

### 2.3 Passage-level findings (real content)

After filtering Related Documents tables (12 of the top 20 - format duplication, not content per F6 brief), intentional JD boilerplate, REF-005 example SLAs, and stub bodies:

| Score | A | B | Read | Proposed disposition |
|---|---|---|---|---|
| **0.535** | POL-003 §06 Staff Rules | SOP-009 §03 What This Means in Practice | Both restate the same four-bullet supplements rule. **Real drift already present**: POL-003 says "club-directed, NSF-certified program", SOP-009 says "client-directed, NSF-certified program." Same idea, different word. SOP-009 is meant to be the operating procedure for the POL-003 policy, not a paraphrase. | **Replace SOP-009 §03 body bullets with `<Include doc="POL-003" section="06 Staff Rules" />`** (or change the SOP-009 wording to match POL-003 verbatim and add `<SourceGoverns doc="POL-003" section="06" />` at the top of SOP-009 §03). The `<Include>` path is cleaner - SOP-009 then literally renders POL-003's bullets at resolve-time. Either way, one source of truth. F7 fix candidate. |
| **0.451** | POST-001 / The four severity tiers | SOP-002 §04 Severity Tiers | POST-001 already carries `<SourceGoverns doc="SOP-002" section="sections 04 + 06" />` at the top. The tier text is intentionally distilled wall-poster copy (e.g., dropped "cross-contact identified after plating" from S2, dropped "damage $250-1,000" from S3). | **Leave the structure alone; verify drift.** SourceGoverns already declares SOP-002 wins on conflict, so the resolver enforces alignment in the corpus. But the wall posting omits two specific examples. **Decide:** keep the abbreviated wall copy (operator floor-readability wins) OR re-include the missing examples (consistency wins). Recommend keeping abbreviated - that is the point of POST docs. No F7 change. |

### 2.4 Intentional duplication, deliberately NOT flagged

For transparency, the categories deliberately excluded from the "real findings" tables above:

| Category | Examples | Why not flagged |
|---|---|---|
| **JD template parallelism** | TPL-101 / TPL-102 / TPL-103 / TPL-104 at 0.519-0.536 doc-pair, "About KitchFix" / "Total Rewards" / "Job Advertisement Block" sections at 1.000 passage | Job descriptions for four roles share the same recruiting block by design. The repeated blocks ARE the brand-consistent boilerplate per STD-001. Drift here would actively damage hiring consistency. Future polish (F7+) can extract to a shared partial; for now, identical-on-purpose. |
| **Example SLA pair** | REF-005-A / REF-005-B at 0.388 doc-pair | Two intentionally parallel sample SLAs (one MLB, one PDC). Built to be visually compared side-by-side. Sharing scaffolding language is the literal point. |
| **Related Documents tables** | SOP-014 / TPL-019, POL-004 / POL-006, REF-006 / REF-007, FORM-009 / POL-019 at 0.4-0.6 passage scores | These passages are tables of pointers (`| Doc ID | Title | Status |`). Format duplication, not content duplication. Per F6 brief: "structural repetition" categorized as not-a-problem. |
| **SourceGoverns-prefaced distillations** | POST-001 / SOP-002 (already analyzed above), POST-002 / SOP-002 if applicable, POSTER series | POST-class docs are by-design distillations of an anchor SOP. The `<SourceGoverns>` token declares the anchor wins on conflict. That is the F-spec's mechanism for exactly this case. |
| **Frontmatter-only stubs** | TPL-007 / TPL-008 / TPL-009 / TPL-016 etc. at 0.28-0.32 doc-pair | All stubs share the language "Frontmatter-only stub for X. Implements/Retired/superseded by Y." That is the stub template, not duplication risk. |
| **Required legal boilerplate** | AGR-001 / AGR-002 acknowledgment sections (if they surface in future passes) | "Signature / Date / Print Name" blocks must be stated identically. Drift would be a legal problem. Not flagged. |

---

## 3. "Human Resources" body mentions

Per F5, the canonical KitchFix function name is **People Operations**. The F5 sweep handled frontmatter `owner:` fields (44 docs touched). F6 surfaces every remaining body mention.

Ran `scripts/content/_probe_hr_mentions.mjs`: skips frontmatter, skips `<NonCanonical>` blocks, skips "People Operations (HR)" parenthetical first-references. Result: **28 mentions across 11 docs.**

### 3.1 The list

| Doc | Mentions | Sample context | Recommended disposition |
|---|---|---|---|
| **SOP-002** | 12 | Operational owner / triage role / escalation target / "Claim Coordinator: Human Resources" / "Notify per Human Resources Formal Disciplinary Process" / "Call Human Resources directly" / "Manager of Record participates in root-cause review with Human Resources" / "PDF maintained by Human Resources" / "Annual review by Human Resources" | **Sweep all 12 to "People Operations".** "Human Resources Formal Disciplinary Process" is a named process; keep that label as-is if the SOP-004 doc title is "Formal Disciplinary Process" - otherwise rename. |
| **AGR-001** | 3 | "6. Human Resources." (escalation step in chain) / "raised directly to Human Resources at any point in the chain" / "contact your RDO or Human Resources" | **Sweep all 3 to "People Operations".** |
| **FORM-001** | 3 | Section header `## 6 - Human Resources Receipt` / "Submit completed form to Human Resources within 24 hours" / "HR enters the case ID" | **Sweep all 3 to "People Operations".** Section header becomes `## 6 - People Operations Receipt`. The bare "HR enters the case ID" can stay HR if Kevin wants the abbreviation convention preserved post-first-reference, or change to "People Operations enters the case ID." |
| **PB-008** | 2 | "Notify Human Resources and corporate" / "Site Leader notifies Human Resources and corporate" | **Sweep both to "People Operations".** |
| **SOP-010** | 2 | "on file with Human Resources" / "Notify Human Resources and the VP of Operations" | **Sweep both.** |
| **FORM-002** | 1 | "This worksheet plus photos goes to Human Resources within 24 hours" | **Sweep.** |
| **PB-003** | 1 | "HR-grade conduct concern - directly to Human Resources per AGR-001 section 06" | **Sweep "Human Resources" -> "People Operations"; keep "HR-grade" as the modifier.** |
| **PB-007** | 1 | "Human Resources coordinates every claim" | **Sweep.** |
| **PB-013** | 1 | "Human Resources - owns the program - the certification matrix" | **Sweep.** |
| **SOP-005** | 1 | "Human Resources - owns compliance - work authorization, paperwork" | **Sweep.** |
| **STD-002** | 1 | "Translation workflow: AI ... Human Resources ..." (truncated; verify in source) | **Sweep.** |

### 3.2 Edge cases worth flagging before a blanket sweep

- **"Human Resources Formal Disciplinary Process"** (SOP-002 line 31). SOP-004's actual title is "Formal Disciplinary Process" (no "Human Resources" prefix). The phrasing in SOP-002 is descriptive, not a proper name. **Rewrite to:** "Disciplinary action - handled through the SOP-004 Formal Disciplinary Process owned by People Operations."
- **AGR-001 escalation-chain step "6. Human Resources."** (line 146) - this is a numbered list item that names HR as the escalation rung. **Rewrite to:** "6. People Operations." Verify the AGR-001 NOTE just above doesn't say "the steps to People Operations end at step 6" or similar - it doesn't, but worth a glance.
- **FORM-001 section header** (line 40, `## 6 - Human Resources Receipt`) - if renamed, all body references to "this Human Resources Receipt" within FORM-001 need to match.

### 3.3 Proposed F7 mechanical sweep

Single deterministic pass: literal `Human Resources` -> `People Operations` everywhere outside frontmatter and `<NonCanonical>` blocks, with three carve-outs handled separately (the SOP-002 disciplinary-process phrasing, the FORM-001 section header rename, the SOP-002 §10 "Claim Coordinator | Human Resources" table cell - that one is just a sweep). Kevin confirms the batch then it runs in a single commit. **No content changes at F6.**

---

## 4. Relationship graph

Ran `scripts/content/_probe_relationships_check.mjs` against all 100 docs.

### 4.1 Orphan docs (0 inbound relationships)

Excludes Retired and Placeholder docs (those don't need inbound by design).

| Status | Class | in_corpus | ID | Title | Read |
|---|---|---|---|---|---|
| In Build | PB | no | PB-004-ES | Hourly Employee Handbook (ES) | Translation of PB-004. Has `translation_of: PB-004` in frontmatter. The graph probe doesn't count `translation_of` as inbound. **Either:** (a) add an explicit `relationships: [{ to: PB-004, type: translation_of }]` reciprocal entry, or (b) accept that translations are reachable via the language-pair convention. **Recommend:** leave alone; translation_of is the canonical pointer. |
| In Build | POL | no | POL-006-ES | Política contra el Acoso | Same as above (POL-006 ES pair). Leave alone. |
| Live | POST | no | POST-001-ES | Reporte de Incidentes | Same; POST-001 EN pair. Leave alone. |
| Pending | REF | no | REF-004 | Org Chart | Standalone reference card. Will be referenced from PB-001 once leadership org is finalized. **Recommend:** add reference edge from PB-001 to REF-004 when the org chart promotes to Live. F7 follow-up. |
| In Build | TPL | no | TPL-012 | Hourly Cycle Review | Tool template that SOP-007 (hourly Formal Performance Process, parallel to SOP-001) should reference. **Recommend:** SOP-007 -> TPL-012 edge when SOP-007 is built out. Currently both are stubs. |
| In Build | TPL | no | TPL-013 | Hourly 30-Day Check | Same as TPL-012. SOP-007 should reference. |
| In Build | TPL | yes | TPL-015 | Legacy SOP Intake Worksheet | Intake worksheet for legacy doc digitization. **Genuinely standalone** - it's a tool, not part of the operating doctrine. Leave orphan. |
| In Build | TPL | no | TPL-101 | Internal JD - Cook | Should be referenced from POL-010 (Hiring) once POL-010 is built, or from REF-002 (Org / Roles directory) if it exists. **Recommend:** add reference edge from POL-010 to all four JD templates when POL-010 promotes. F7. |
| In Build | TPL | no | TPL-102 | Internal JD - Dishwasher | Same. |
| In Build | TPL | no | TPL-103 | Internal JD - FOH Cafe Attendant | Same. |
| In Build | TPL | no | TPL-104 | Internal JD - Culinary Delivery Driver | Same. |

### 4.2 Missing-edge proposals (body cites doc ID; no relationships entry)

Probe found 39 total. Filtered to substantive (excluding 18 from stub bodies which just say "Frontmatter-only stub for X superseded by Y" - those entries will populate naturally when the stubs get bodies):

| From | To | Sample context | Edge type proposed | Reasoning |
|---|---|---|---|---|
| FORM-004 | POL-002 | "- Dress code / appearance (POL-002)" | references | FORM-004 references POL-002 in the conduct categories list. |
| FORM-007 | SOP-001 | "Performance Review on File - Type + date - SOP-007 (hourly) or SOP-001 (salary)" | references | FORM-007 explicitly cites both performance SOPs. |
| FORM-007 | SOP-007 | Same line | references | Same. |
| PB-013 | PB-010 | "Leadership triad - Everything above, plus people, P&L, client, and team" | references | PB-013 references PB-010 (Tools section) in the leadership context. Verify - may be a triad-table caption rather than a real edge. |
| PB-013 | TPL-001 | "Scorecards & reviews - the cadence tools that make development concrete" | references | PB-013 cites TPL-001 (Scorecard) in cadence tools. |
| POST-002 | SOP-002 | "Notify within 10 minutes - Client and KitchFix leadership. Severity..." | references | POST-002 mentions SOP-002 once but already has `derived_from: SOP-002` - verify the probe didn't miss a `derived_from` match. If missed, this is a false positive. |
| POST-003 | FORM-008 | "Hygiene and health - handwashing per SOP-008 §11; sick staff..." | references | FORM-008 mention in POST-003. |
| POST-003 | PB-002 | "Allergens - the Top 9 per PB-002; cross-contact prevention" | references | Real edge. PB-002 is the Allergen Playbook. |
| POST-003 | PB-007 | "Hot surfaces - 'behind, hot, knife, heavy' call-out is the kitchen..." | references | Real - PB-007 is referenced for kitchen safety calls. |
| POST-003 | POST-001 | "see POST-001 for the call-by-tier matrix" | related | Wall-poster cross-reference. Real edge. |
| POST-003 | SOP-002 | "Notify per SOP-002 severity matrix" | derived_from or references | Real - POST-003 implements SOP-002 §07. |
| REF-005-A | PB-001 | Body table row: "PB-001 - Leadership OS Handbook - The leadership system..." | references | REF-005-A's "cited docs" table. Whether these should be relationships is a judgment call - they're catalog entries inside the SLA, not the SLA's policy chain. **Recommend:** leave alone; the body is illustrative not normative. |
| REF-005-A | PB-003 | Same table | references | Same. Recommend leave alone. |
| REF-005-A | STD-001 | Same table | references | Same. Recommend leave alone. |
| REF-005-B | PB-001 | Same as REF-005-A | references | Same. Recommend leave alone. |
| REF-005-B | PB-003 | Same | references | Same. Recommend leave alone. |
| REF-005-B | STD-001 | Same | references | Same. Recommend leave alone. |
| SOP-001 | SOP-007 | "Cross-references: PB-001 (Leadership OS Handbook) carries the operating..." | related | SOP-001 explicitly mentions SOP-007 as the hourly-track parallel. Add `related` edge. |
| SOP-008 | AGR-001 | "Route all communication through Kitchfix" (near AGR-001 mention - verify line) | references | Verify - the sample line shown was at L310 truncated. May be a media-handling reference. |
| SOP-009 | AGR-001 | "See POL-003 Drug & Alcohol Policy section 06 for the underlying rule" (AGR-001 may be in same paragraph) | references | Verify - probe may have caught an adjacent doc ID. |
| SOP-009 | SOP-004 | "Distributing a non-NSF-certified product that results in a positive test" | references | SOP-009 §05 explicitly says "the conduct falls under SOP-004 Formal Disciplinary Process per POL-003 section 08." Real edge. |
| STD-001 | AGR-001 | "Format: 'see SOP-014 section 3.2' or 'per AGR-001 The Big Rules.'" | references | STD-001 uses AGR-001 as an example. Whether this needs a relationship is borderline - the mention is illustrative. **Recommend:** leave alone unless Kevin wants STD-001 to formally point to AGR-001. |
| STD-001 | PB-001 | "- ID - class prefix and number (PB-001, STD-001, AGR-001)" | references | Same illustrative use. Leave alone. |
| STD-001 | SOP-014 | Same line as AGR-001 | references | Same. Leave alone. |
| STD-003 | FORM-003 | "Performance coaching and disciplinary conversations (FORM-003, FORM-00..." | references | STD-003 lists the disciplinary forms. Real edge. |
| STD-003 | FORM-004 | Same line | references | Same. |
| STD-003 | FORM-006 | "Termination conversations (FORM-006 per SOP-004)" | references | Real edge. |

**Recommended additions (clean, high-confidence):** 11 edges

- FORM-004 -> POL-002 (references)
- FORM-007 -> SOP-001, SOP-007 (references x2)
- PB-013 -> TPL-001 (references)
- POST-003 -> PB-002, PB-007, POST-001, SOP-002, FORM-008 (5 edges)
- SOP-001 -> SOP-007 (related)
- SOP-009 -> SOP-004 (references)
- STD-003 -> FORM-003, FORM-004, FORM-006 (3 edges)

**Recommended verify-before-add:** POST-002 -> SOP-002 (may already be `derived_from`), SOP-008 -> AGR-001 (verify line 310 context), SOP-009 -> AGR-001 (verify), PB-013 -> PB-010 (verify caption vs real ref).

**Recommended leave alone (illustrative mentions, not normative pointers):** REF-005-A/B cited-doc tables (6 entries), STD-001's AGR-001/PB-001/SOP-014 example IDs (3 entries).

### 4.3 Stub-body missing edges (deferred)

18 missing edges are inside frontmatter-only stub bodies (TPL-007, TPL-008, TPL-009, TPL-016, TPL-017, POL-005, POL-016, REF-001, SOP-007). The stub text reads "Frontmatter-only stub for X. Implements/Retired/superseded by Y." Those edges will be added naturally when each stub gets a real body. **Not actionable at F6.**

---

## 5. What this report does NOT do

Per F6 task brief, **F6 surfaces and proposes; it does not change content.** Not in this pass:

- The "Human Resources" -> "People Operations" sweep is **proposed**, not applied. Kevin confirms; the actual sweep is an F7 commit.
- The SOP-009 §03 / POL-003 §06 single-sourcing fix is **proposed**, not applied. F7 candidate.
- The 11 high-confidence relationship edges are **proposed**, not added. F7 candidate.
- The POST-001 distillation drift is **noted**, not modified. SourceGoverns already covers it; no action needed.
- No catalog DB write (F7).
- No production embedding pass (F8).
- No git merge to main.

---

## 6. F6 summary

| Layer | Result |
|---|---|
| Validation gate | Held at 0 ERRORs from F5 |
| Duplicate liability surface | 2 real items; 1 actionable in F7 (SOP-009 §03 / POL-003 §06) |
| Terminology consistency | 28 HR -> People Operations sweep candidates ready for F7 batch |
| Relationship graph health | 11 high-confidence edges to add in F7; 4 to verify; 6 to leave illustrative; orphan translations and pending refs are accounted for |

**STOP at CK-F.** F7 (governance + catalog wiring) is the next gate.

---

## Appendix - Probe scripts (for re-running)

```bash
# Validation
node scripts/content/validate.mjs

# Dedup sweep (writes .scratch/opd-audit/f6-dedup-sweep.json)
node scripts/content/_probe_dedup_sweep.mjs

# HR-mentions sweep
node scripts/content/_probe_hr_mentions.mjs

# Relationship graph check (orphans + missing edges)
node scripts/content/_probe_relationships_check.mjs
```

All four are pure node, no new deps. Safe to re-run after every future edit pass.
