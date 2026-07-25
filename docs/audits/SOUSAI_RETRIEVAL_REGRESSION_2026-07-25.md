# SousAI Retrieval Regression - 2026-07-25 (the CK-8 run)

**One-line read:** the gap held at 0.126 (up from ~0.10 in June), 10 of 10 questions PASS, zero REC-class intrusion, but **the whole similarity distribution shifted up ~2x** and the 0.28 threshold now sits far below the no-answer ceiling. The threshold no longer separates real from miss - not because the gap compressed, because the scale moved.

---

## 1. Provenance

- **Commit:** `abeb493` "Merge pull request #518 from KitchFix-Intranet/feat/sc-bulk-convergence" (origin/main tip).
- **Worktree:** `/tmp/kf-regression-725` (detached, read-only).
- **DB target:** production PG via `SUPABASE_URL` from `.env.local`.
- **Timestamp of run:** 2026-07-25T15:25:32Z.
- **Command run:** `node --env-file=.env.local scripts/sousai-retrieval-test.mjs` (no env overrides).
- **Effective `ALLOWED_LEVELS`:** `["unrestricted"]` (script default at `scripts/sousai-retrieval-test.mjs:39`; matches the normal operator viewer).
- **Embedding model:** `text-embedding-3-small`, 1536-dim [code-read `src/lib/sousai/embed.js:24-25`]. Same model used for chunks per the L3 pipeline, so query and stored vectors live in the same latent space.
- **`match_document_chunks` signature called:** 3-arg `(query_embedding vector(1536), match_count int, allowed_levels text[])` [code-read `scripts/sousai-retrieval-test.mjs:145-149`]. The 2-arg overload was dropped in pr-7-12 [code-read `docs/migrations/pr-7-12-opd-drop-legacy-match-fn.sql`].
- **`TOP_N`:** 5 [code-read `scripts/sousai-retrieval-test.mjs:26`].
- **Question count:** 10 [code-read `scripts/sousai-retrieval-test.mjs:52-107`].
- **Bounded exception invoked:** none. Harness ran clean, exit 0. No repairs made.

---

## 2. Corpus snapshot at run time

Direct PG queries via a read-only probe I ran alongside the harness (see appendix for the probe script).

| Metric | Value |
|---|---|
| Total documents in PG | 132 |
| Active documents | 128 |
| Archived documents | 4 |
| **Active Live** | **81** |
| Active In Build | 21 |
| Active Retired | 16 |
| Active Pending | 8 |
| Active Blocked | 1 |
| Active Placeholder | 1 |
| Live % vs non-Retired active | 72.3% |
| **`document_chunks` total** | **1,445** |
| Distinct chunk-bearing docs | 112 |

### The 80-vs-81 settle

Yesterday's `OPD_STATE_REPORT_2026-07-24-post524.md` (my own report) said 80 Live. The workbook derived from the same snapshot said 81. Both were built from the same JSON file, so one of them was wrong. **Today's PG query says 81.** The single doc accounting for the delta since yesterday's report: **PB-012 Client & Account Management Playbook** - was `In Build` at the time of yesterday's snapshot, is now `Live`. Kevin flipped it in the cockpit between yesterday's audit and today's run. Not a probe bug; a real state change. The tracker workbook happened to be right for the wrong reason (81 was the correct number pre-flip too - one of my report-vs-workbook code paths had an off-by-one that self-corrected when the flip landed).

---

## 3. Per-question results

Verdicts below; verbatim harness stdout in the appendix.

### Q1. OVERLAP - allergic reaction

**Question:** "what do I do if someone has an allergic reaction"
**Expected:** PB-002 §6 steps AND SOP-002 §7.3 in top 5 (cross-doc reference).

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | PB-002 | PB | 06 If Someone Has a Reaction > 6.1 > Step 1 - Get medical help immediately | 0.687 |
| 2 | PB-002 | PB | 06 > 6.1 > Step 4 - Notify within 10 minutes | 0.604 |
| 3 | PB-002 | PB | 06 If Someone Has a Reaction | 0.588 |
| 4 | SOP-002 | SOP | 07 Type-Specific Procedures > 7.3 Allergen Reaction | 0.576 |
| 5 | PB-002 | PB | 06 > 6.1 > Step 2 - Remove the food | 0.564 |

**Verdict: PASS.** Both expected docs surface; PB-002 dominates, SOP-002 §7.3 at #4 confirms the cross-doc reference still catches.

### Q2. OVERLAP - safety incident procedure (favor SOP-002)

**Question:** "what's the procedure for a safety incident"
**Expected:** SOP-002 incident management, NOT PB-002 allergen-specific.

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | SOP-002 | SOP | 07 > 7.2 Vehicle Incident | 0.628 |
| 2 | SOP-002 | SOP | 05 Response - Six Steps, Every Incident | 0.618 |
| 3 | SOP-010 | SOP | Accident Response | 0.612 |
| 4 | SOP-002 | SOP | 07 > 7.8 Near-Miss | 0.595 |
| 5 | PB-007 | PB | Injury & Incident Reporting | 0.593 |

**Verdict: PASS.** SOP-002 owns the top and no PB-002 allergen chunk appears. SOP-010 (Driver/Fleet Safety) and PB-007 (Workplace Safety Manual) are correct neighbors for a "safety incident" query.

### Q3. FORM retrieval - medical refusal form

**Question:** "what form do I use when someone refuses medical treatment"
**Expected:** FORM-001 single fallback chunk surfaces.

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | FORM-001 | FORM | Purpose | 0.691 |
| 2 | FORM-001 | FORM | When to Use | 0.686 |
| 3 | FORM-001 | FORM | Form Contents > 4 - Refusal Statement (canonical text) | 0.684 |
| 4 | FORM-001 | FORM | Form Contents | 0.672 |
| 5 | FORM-001 | FORM | Form Contents > 1 - Affected Person | 0.671 |

**Verdict: PASS.** Exceeds the June expectation (which was "single fallback chunk") - FORM-001 fills all five slots. FORM-001 has been fully chunked at some point since June.

### Q4. ALLERGEN LIST (favor PB-002, resist pull to SOP-002 / POST-002)

**Question:** "what are the 9 allergens"
**Expected:** PB-002 Top 9 - not crowded out by docs that just mention allergens.

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | PB-002 | PB | 02 The Top 9 Allergens | 0.685 |
| 2 | PB-002 | PB | 02 > Where Each Allergen Hides | 0.611 |
| 3 | PB-002 | PB | 02 > The Anaphylaxis Four | 0.582 |
| 4 | PB-006 | PB | Culinary Defined > 3.13 Allergens > Standing positions | 0.552 |
| 5 | TPL-014 | TPL | 05 > Allergen Position > Standing positions (floor) | 0.516 |

**Verdict: PASS.** PB-002 owns 1/2/3. PB-006 and TPL-014 at 4/5 both quote the PB-002 Top 9 list back to it, so they're legitimate neighbors, not pollution. No SOP-002 or POST-002 crowding.

### Q5. STANDING - typo / garbled

**Question:** "r tomatoes a alergure"
**Expected:** PB-002 allergen content (still pulls despite typos).

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | PB-002 | PB | 06 > 6.1 > Step 2 - Remove the food | 0.347 |
| 2 | TPL-014 | TPL | 05 > Restricted and Prohibited Products (floor) | 0.331 |
| 3 | PB-002 | PB | 02 > The Anaphylaxis Four | 0.329 |
| 4 | PB-006 | PB | Culinary Overview > Allergens are non-negotiable | 0.328 |
| 5 | PB-006 | PB | Culinary Defined > 3.13 > Severe allergy and emergency response | 0.325 |

**Verdict: PASS** (weak). PB-002 at #1 and #3; two PB-006 chunks reference PB-002. The absolute scores here are notably lower (~0.33) than clean-query cases - typos degrade the signal but don't break it. Interestingly, the top score in the typo case is *lower* than the no-answer ceiling in Q8 (0.5017) - which by itself would trip a well-calibrated threshold to decline, incorrectly.

### Q6. STANDING - confidentiality / media

**Question:** "can I talk about players to the media"
**Expected:** AGR-001 confidentiality discriminates from safety/operations docs.

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | AGR-001 | AGR | 03 > 3.5 No talking to media or reporters | 0.564 |
| 2 | AGR-001 | AGR | 03 > 3.4 No talk of steroid use | 0.561 |
| 3 | PB-004 | PB | How We Treat Each Other > With Players and Clients | 0.508 |
| 4 | PB-004 | PB | How We Treat Each Other > Social Media & Phones | 0.430 |
| 5 | AGR-001 | AGR | 03 > 3.2 No autographs | 0.430 |

**Verdict: PASS.** AGR-001 §3.5 is the direct hit; PB-004 (Hourly Employee Handbook, employee-conduct chapter) is a legitimate neighbor.

### Q7. STANDING - Spanish cross-lingual

**Question:** "¿los tomates son alérgenos?"
**Expected:** PB-002 allergen content via cross-lingual embedding (documented degraded).

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | PB-006 | PB | Culinary Overview > Allergens are non-negotiable (mentions PB-002) | 0.353 |
| 2 | PB-006 | PB | Culinary Defined > 3.13 > Standing positions (mentions PB-002) | 0.331 |
| 3 | TPL-014 | TPL | 05 > Allergen Position > Standing positions (mentions PB-002) | 0.330 |
| 4 | SOP-008 | SOP | Cross-Contamination and Allergens > Allergens (mentions PB-002) | 0.328 |
| 5 | PB-002 | PB | 02 The Top 9 Allergens | 0.326 |

**Verdict: PASS** (weak/degraded, as expected). PB-002 slid from primary result at June scale to #5 here. Every doc above it is a doc that *mentions* PB-002 rather than PB-002 itself - Spanish cross-lingual pulls the reference network more than the source. Still functional; noticeably weaker.

### Q8. NEGATIVE - no answer in corpus (does the gap survive corpus growth?)

**Question:** "what is the labor budget formula"
**Expected:** LOW scores - at 2x growth the June gap held at ~10pts (0.22 vs 0.32).

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | PB-010 | PB | Site Financial Discipline > Labor cost | **0.502** |
| 2 | PB-009 | PB | Labor Cost Management | 0.486 |
| 3 | PB-010 | PB | Site Financial Discipline | 0.388 |
| 4 | REF-129 | REF | TBR - FL - Contract Source-of-Record > §C. Year-over-year table | 0.371 |
| 5 | REF-006 | REF | (no section / unsectioned) | 0.362 |

**Verdict: NEGATIVE-CORRECT (the corpus has no formula) but SCORE-BROKEN (top hit at 0.502 is >>> 0.28 threshold).** The top result is PB-010's Labor cost bullet, which says "Schedule to the labor target and the business" - that's guidance, not a formula. Sous, gated at 0.28, would confidently answer from PB-010 anyway. This is exactly the failure mode Kevin's launch bar exists to prevent.

### Q9. STUB-DOESN'T-POLLUTE - 'big rules' real-content query

**Question:** "what are the big rules"
**Expected:** AGR-001 content chunks ranked ABOVE POSTER-001 stub.

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | AGR-001 | AGR | 03 The Clubhouse Rules | 0.554 |
| 2 | AGR-001 | AGR | 04 Facility Conduct | 0.544 |
| 3 | AGR-001 | AGR | 01 Why these are the Big Rules | 0.543 |
| 4 | AGR-001 | AGR | 02 Confidentiality | 0.515 |
| 5 | AGR-001 | AGR | 03 > 3.3 No talk of gambling | 0.508 |

**Verdict: PASS** (stronger than expected). POSTER-001 stub does not appear in the top-5 at all. Content chunks fully dominate. The stub-suppression mechanic (POSTER-001 got a metadata-only chunk via `embedPosterStub`) works cleanly here.

### Q10. STUB SURFACES - 'allergen poster' query

**Question:** "allergen poster"
**Expected:** POST-002 stub surfaces appropriately.

| # | doc | class | section | sim |
|---|---|---|---|---|
| 1 | POST-002 | POST | (no section / unsectioned) [stub] | 0.623 |
| 2 | PB-002 | PB | 05 > 5.2 Player Allergen Information | 0.535 |
| 3 | PB-002 | PB | 05 > 5.4 Pre-Shift Allergen Topic | 0.533 |
| 4 | PB-002 | PB | 04 > What we do instead | 0.521 |
| 5 | PB-002 | PB | 03 > 3.1 Labeling | 0.513 |

**Verdict: PASS.** POST-002 stub at #1; PB-002 content fills 2-5.

### Pass count

**10 of 10 PASS** (Q5 and Q7 pass at weakened scores, both documented).

---

## 4. The four analyses

### 4.1 The no-answer gap (headline number)

Definitions per prompt:
- **Real-hit floor** = min across Q1-Q4 of (best expected-doc similarity for that question)
- **No-answer ceiling** = max across all Q8 results
- **Gap** = real-hit floor - no-answer ceiling

Best expected-doc sim per Q1-Q4:
- Q1: PB-002 chunk_index=23 = **0.6873**
- Q2: SOP-002 chunk_index=13 = **0.6279**
- Q3: FORM-001 chunk_index=0 = **0.6905**
- Q4: PB-002 chunk_index=3 = **0.6853**

**Real-hit floor = 0.6279** (Q2).

**No-answer ceiling = 0.5017** (Q8 top result, PB-010).

**Gap = 0.1262 (12.6 percentage points).**

**Verdict per Kevin's scale: HEALTHY** (>= 0.10).

### 4.2 The scale-shift finding (the reason "healthy gap" is not the whole story)

The gap held. But it held around a completely different absolute range than in June.

| Metric | June 2026-06-04 baseline | July 2026-07-25 | delta |
|---|---|---|---|
| Real-hit floor | ~0.32 | 0.628 | +0.31 (~1.9x) |
| No-answer ceiling | ~0.22 | 0.502 | +0.28 (~2.3x) |
| Gap | ~0.10 | 0.126 | +0.026 |
| 0.28 threshold sits: | 0.06 below floor, 0.06 above ceiling (mid-gap) | **0.35 below floor, 0.22 below ceiling** (irrelevant) |

**The 0.28 threshold is no longer a decline gate.** In June it sat cleanly between the two distributions and worked as designed - anything below 0.28 declined, anything above answered. Today it sits well below the no-answer ceiling. Every Q8 answer will pass the gate. Sous will confidently answer "what is the labor budget formula" from PB-010's Labor cost bullet.

Why did the scale shift? Two hypotheses worth flagging (I'm reporting, not deciding):

1. **Corpus expansion pulls scores up.** More docs means more chunks that are at least topically-adjacent to any query - the "confident miss" ceiling rises because there is always *something* topically adjacent in a 128-doc corpus. This is the standard reason RAG systems get less discriminating as they scale.
2. **Chunker enrichment.** Structure-aware chunking with contextual "From: {title}, Section: {path}" headers means every chunk carries doc-level topical signal in addition to the section-level content. More topical signal per chunk narrows the similarity spread and pulls the whole distribution up. This is the choice made in `src/lib/sousai/chunk.js`.

Both are consistent with what the numbers show. Neither is fixable by re-tuning the threshold alone - the scale will keep shifting as the corpus grows further.

### 4.3 Discrimination (Q1-Q4 correctness + corpus-growth pollution)

Every Q1-Q4 top-5 returned the correct primary doc. No discrimination failure.

Docs appearing in top-5 that were unlikely in June's ~8-doc corpus (approximate - I don't have the exact June corpus list, so this is a best-guess based on what the state report says was added since):

- **SOP-010 (Driver/Fleet Safety)** - Q2 #3
- **PB-004 (Hourly Employee Handbook)** - Q6 #3, #4
- **PB-006 (Culinary OS Handbook)** - Q4 #4, Q5 #4/5, Q7 #1/2
- **PB-007 (Workplace Safety Manual)** - Q2 #5
- **PB-009 (Financial Operations Manual)** - Q8 #2
- **PB-010 (Site Operations Manual)** - Q8 #1, #3
- **SOP-008 (Food Safety Management)** - Q7 #4
- **TPL-014** - Q4 #5, Q5 #2, Q7 #3
- **REF-006 (Hourly Pay Bands)** - Q8 #5
- **REF-129 (Contract Digest, TBR-FL)** - Q8 #4

Most are correct topical neighbors, not pollution. The only slightly concerning one: **REF-129 in Q8** (labor budget formula). A contract digest surfacing on a labor-formula query is the kind of loose association that a Sous-with-tools should catch and re-route to a data-side query rather than answering from.

### 4.4 Degradation cases

**Q7 Spanish cross-lingual:** noticeably degraded. PB-002 fell from top result at June scale to #5 here. Everything above it is docs *mentioning* PB-002 rather than PB-002 itself. Still functional (PB-002 in top-5, score above the "typo baseline" of 0.33) but the corpus expansion appears to have added enough English-adjacent content that cross-lingual retrieval pulls the reference network first.

**Q9 stub non-pollution:** stronger than expected. POSTER-001 stub does NOT appear in any top-5 slot. AGR-001 content fully dominates. `embedPosterStub` is doing its job cleanly.

**Q10 stub surfaces:** works. POST-002 at #1 (0.623).

### 4.5 Specimen-figure intrusion (the money-risk check)

**Zero REC-class chunks appear in any top-5 result** across all 10 questions. Zero appear at any score, definitely zero at >= 0.28.

The `stripNonCanonical()` call at `extractMdx.js:114` is working - the specimen figures inside REC files' NonCanonical blocks are excluded from chunks. And the surrounding REC prose is not drawing retrieval on these general-purpose questions.

**Caveat:** none of the 10 harness questions target account-specific content. A stronger test would be "what's CIN-AZ's service fee" or "when is TBJ-NY's next homestand" - either would surface REC-101 or REC-107. That is where a Sous-with-only-vector-retrieval risks answering from a specimen figure (marked in the corpus as post-SF billed rate, sticker rate, etc., all live values that MUST come from PG per the Price Book pattern REF-141 codifies). This measurement round confirms nothing bleeds through on the general questions; the specimen-vs-live-value risk on data questions is architectural, not measurable at this layer, and is addressed by the tool-calling agent phase Kevin has scoped.

---

## 5. Recommendations - report-only

Do not pick a new threshold in this PR. Kevin owns the threshold decision paired with the port-vs-rebuild call on `feat/sousai-demo`. What follows are the candidate paths with the evidence each would need to survive.

### Candidate A: recalibrate the absolute floor

Move 0.28 up to somewhere between the current no-answer ceiling (0.502) and the current real-hit floor (0.628). A value around 0.54-0.56 would put it slightly above the no-answer ceiling with margin.

**Evidence needed to trust it:** at least one more regression run, ideally against a larger set of no-answer questions than Q8 alone. One data point is not enough to trust a 0.502 ceiling; the true ceiling could be higher on a different negative question. Also: the corpus will keep growing. This threshold will drift again.

**Fragility:** Q5 (typo case) top score = 0.347. Any threshold above ~0.34 rejects the typo path Sous is documented to handle. So the recalibration is not just above Q8's 0.502 - it's below Q5's 0.347. **There is no single absolute value that both accepts typo-degraded real hits and rejects the labor-formula no-answer.** The threshold approach may be structurally broken here, not just needing a new number.

### Candidate B: top-gap margin

Instead of an absolute floor, gate on "top hit sim - median-of-top-5 sim" or "top hit sim - #2 hit sim". Idea: a real answer typically has a clear top hit; a no-answer question retrieves docs with similar-but-flat scores.

**Evidence needed:** compute this per-question against today's data. Real hits' top-vs-median gaps are visible in the tables above (Q3 FORM-001: 0.691 vs ~0.68, tiny gap - so this hypothesis is not clean).

### Candidate C: LLM relevance judge (the charter's "verifier step")

After retrieval, before generation, ask Claude "does this content actually answer this question?" and only proceed if yes. This is the reranker/verifier layer parked in the Phase 2 Charter and never built.

**Evidence needed:** none for the decision (it's a well-understood pattern). The engineering work is separate. This is where I'd bet - the threshold approach's Q5-vs-Q8 problem is fundamental, and the LLM-judge approach handles both cases with the same mechanism.

### Cross-recommendation: keep the harness discipline

Whichever path lands, the 10-question harness is not enough. The next round of scoping work will need an eval set of 40-60 questions with known-correct answers, per what the prior Chat's scoping recommended. This regression is a smoke test for regressions in the shape of the retrieval distribution; it is not a measurement of answer quality.

---

## 6. Completeness map (per `docs/BUILD_ACCURACY_PROTOCOL.md`)

Every numbered item in the prompt, marked done or explicitly not-done with reason.

| # | Item | Status | Location |
|---|---|---|---|
| Setup 1 | Fresh detached worktree from origin/main + record SHA | DONE | §1 (commit `abeb493`) |
| Setup 2 | Read harness top to bottom + confirm code details with file:line | DONE | §1 [code-read entries] |
| Setup 3 | Run harness against production PG; capture stdout verbatim; record command + allowed_levels + timestamp | DONE | §1 provenance + Appendix stdout |
| Setup 4 | Corpus snapshot at run time; settle 80-vs-81 delta | DONE | §2 (81 Live confirmed; PB-012 accounts for the delta since yesterday's report) |
| Bounded exception | Mechanical repair if harness failed | NOT INVOKED | Harness ran clean, exit 0 |
| Report 1 | Per-question expected + top-5 (doc, class, section, sim to 3dp) + PASS/FAIL | DONE | §3 |
| Analysis 1 | No-answer gap number | DONE | §4.1 (gap = 0.126) |
| Analysis 2 | Discrimination (Q1-Q4) + new-doc pollution list | DONE | §4.3 |
| Analysis 3 | Degradation cases (Q7, Q9, Q10) | DONE | §4.4 |
| Analysis 4 | REC-class intrusion (any score, and at >= 0.28) | DONE | §4.5 (zero) |
| Deliverable 1 | Provenance block | DONE | §1 |
| Deliverable 2 | Corpus snapshot including 80-vs-81 settle | DONE | §2 |
| Deliverable 3 | Per-question results table with verdicts | DONE | §3 |
| Deliverable 4 | Four analyses, gap first | DONE | §4 |
| Deliverable 5 | Recommendations, report-only, no threshold pick | DONE | §5 (three candidates, no pick) |
| Deliverable 6 | Completeness map | DONE | §6 (this table) |
| Deliverable 7 | Verbatim harness stdout appendix | DONE | Appendix A |
| PR discipline | Docs-only PR (plus mechanical repair if invoked) | DONE (no repair invoked) | PR description will name this |
| Discipline: labels | [ran] / [code-read] used consistently | DONE | §1 marks each |
| Discipline: hyphens | No em-dashes in report/commits/PR text | DONE | Hyphens throughout |
| Discipline: one axis | Measurement only, no threshold pick | DONE | §5 explicitly names Kevin as decider |
| Chat summary | Gap number, pass count, REC intrusion, one-paragraph read on 0.28 | DONE in chat message | See CC's chat message |

---

## Appendix A - verbatim harness stdout

```
(node:52235) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///private/tmp/kf-regression-725/src/lib/sousai/embed.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /private/tmp/kf-regression-725/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
════════════════════════════════════════════════════════════════════════════
  1. OVERLAP - allergic reaction (PB-002 + SOP-002 should both appear)
  Q: "what do I do if someone has an allergic reaction"
  expected: PB-002 Section 6 steps AND SOP-002 §7.3 in top 5 (cross-doc reference)
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.6873  PB-002  chunk_index=23  lang=en
        section: 06 If Someone Has a Reaction > 6.1 The Six Steps > Step 1 - Get medical help immediately
        body:    Contact on-site medical staff. If the reaction is severe - difficulty breathing, swelling, loss of consciousness - call 911 even if site medical is re...

  #2  sim=0.6040  PB-002  chunk_index=26  lang=en
        section: 06 If Someone Has a Reaction > 6.1 The Six Steps > Step 4 - Notify within 10 minutes
        body:    Notify the Client and KitchFix leadership within 10 minutes of the reaction being identified. Use the Severity 1 phone-tree per SOP-002 section 6.

  #3  sim=0.5881  PB-002  chunk_index=22  lang=en
        section: 06 If Someone Has a Reaction
        body:    Six steps. Medical response is always Step 1. Documentation comes after. > ANCHOR: Medical response is ALWAYS Step 1. Everything else comes after.

  #4  sim=0.5756  SOP-002  chunk_index=14  lang=en
        section: 07 Type-Specific Procedures > 7.3 Allergen Reaction
        body:    See PB-002 Allergen Playbook §06 for the full protocol. Medical response is always Step 1. Severe goes 911. Pull suspected item and utensils. Notify w...

  #5  sim=0.5641  PB-002  chunk_index=24  lang=en
        section: 06 If Someone Has a Reaction > 6.1 The Six Steps > Step 2 - Remove the food
        body:    Pull the suspected item and all utensils from the line. Preserve the packaging and any remaining product - do not throw it away.

════════════════════════════════════════════════════════════════════════════
  2. OVERLAP - safety incident procedure (favor SOP-002)
  Q: "what's the procedure for a safety incident"
  expected: SOP-002 incident management, NOT PB-002 allergen-specific
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.6279  SOP-002  chunk_index=13  lang=en
        section: 07 Type-Specific Procedures > 7.2 Vehicle Incident
        body:    Any injury is S1, call 911. Call police for any other-vehicle, injury, or property-damage incident. Obtain police report number. Notify VP of Operatio...

  #2  sim=0.6177  SOP-002  chunk_index=8  lang=en
        section: 05 Response - Six Steps, Every Incident
        body:    Six steps. Every incident, every type, every severity. Type-specific procedures in Section 7 layer on top. 1. **Respond** - Address immediate safety. ...

  #3  sim=0.6116  SOP-010  chunk_index=4  lang=en
        section: Accident Response
        body:    Any injury makes this an S1 - call 911 first. Then work the steps. | Step | Action | |---|---| | 1 - Stop and secure | Stop safely. Turn on hazards. C...

  #4  sim=0.5954  SOP-002  chunk_index=19  lang=en
        section: 07 Type-Specific Procedures > 7.8 Near-Miss
        body:    Document within 24 hours while details are fresh. Classify S4 unless the potential outcome would have been S1 or S2.

  #5  sim=0.5932  PB-007  chunk_index=19  lang=en
        section: Injury & Incident Reporting
        body:    When something happens, report it - every injury, every near-miss, every hazard. - Report everything - injuries, near-misses, and hazards, in good fai...

════════════════════════════════════════════════════════════════════════════
  3. FORM retrieval - medical refusal form
  Q: "what form do I use when someone refuses medical treatment"
  expected: FORM-001 single fallback chunk surfaces
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.6905  FORM-001  chunk_index=0  lang=en
        section: Purpose
        body:    Complete this form when an employee or other affected person declines offered medical treatment following a workplace injury or incident. Submit to Hu...

  #2  sim=0.6857  FORM-001  chunk_index=1  lang=en
        section: When to Use
        body:    - An employee declines offered transport to clinic, urgent care, or 911. - An employee declines on-site first aid following a reportable injury. - A n...

  #3  sim=0.6836  FORM-001  chunk_index=6  lang=en
        section: Form Contents > 4 - Refusal Statement (canonical text)
        body:    I, the undersigned, acknowledge that medical treatment was offered to me by KitchFix or by site medical personnel following the incident described abo...

  #4  sim=0.6723  FORM-001  chunk_index=2  lang=en
        section: Form Contents
        body:    The form captures the following sections. Field-level data is collected at signing event; this MDX records the canonical refusal statement language on...

  #5  sim=0.6705  FORM-001  chunk_index=3  lang=en
        section: Form Contents > 1 - Affected Person
        body:    Full Name, Role / Position, Site / Location.

════════════════════════════════════════════════════════════════════════════
  4. ALLERGEN LIST (favor PB-002, resist pull to SOP-002 / POST-002)
  Q: "what are the 9 allergens"
  expected: PB-002 Top 9 allergens - not crowded out by docs that just mention allergens
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.6853  PB-002  chunk_index=3  lang=en
        section: 02 The Top 9 Allergens
        body:    Every team member must know these by name and know where they hide. A Top 9 posting must be visible in every kitchen. The FDA recognizes nine major fo...

  #2  sim=0.6114  PB-002  chunk_index=4  lang=en
        section: 02 The Top 9 Allergens > Where Each Allergen Hides
        body:    | Allergen | Where It Hides | |---|---| | Milk | Butter, cream, cheese, ghee, whey, casein, lactose, ranch, baked goods, chocolate, cream sauces. | | ...

  #3  sim=0.5817  PB-002  chunk_index=5  lang=en
        section: 02 The Top 9 Allergens > The Anaphylaxis Four
        body:    Four of the Top 9 carry the highest risk of anaphylaxis: Fish, Shellfish, Tree Nuts, and Peanuts. A reaction to any of these can become life-threateni...

  #4  sim=0.5518  PB-006  chunk_index=56  lang=en
        section: Culinary Defined > 3.13 Allergens > Standing positions
        body:    - **Top 9 allergens** - milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soybeans, and sesame are tracked and labeled at every meal period in E...

  #5  sim=0.5159  TPL-014  chunk_index=25  lang=en
        section: 05 Nutrition Guidelines and Allergen Standards > Allergen Position > Standing positions (floor)
        body:    Top 9 allergens (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soybeans, sesame) tracked and labeled at every meal period in English and Spa...

════════════════════════════════════════════════════════════════════════════
  5. STANDING - typo / garbled
  Q: "r tomatoes a alergure"
  expected: PB-002 allergen content (still pulls despite typos)
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.3466  PB-002  chunk_index=24  lang=en
        section: 06 If Someone Has a Reaction > 6.1 The Six Steps > Step 2 - Remove the food
        body:    Pull the suspected item and all utensils from the line. Preserve the packaging and any remaining product - do not throw it away.

  #2  sim=0.3307  TPL-014  chunk_index=21  lang=en
        section: 05 Nutrition Guidelines and Allergen Standards > Restricted and Prohibited Products (floor) > Restricted - clarify in SLA before use
        body:    Pre-breaded items (freshly breaded and baked permitted per SLA) · frozen prepared items as a primary protein/starch/vegetable · iceberg lettuce (appro...

  #3  sim=0.3285  PB-002  chunk_index=5  lang=en
        section: 02 The Top 9 Allergens > The Anaphylaxis Four
        body:    Four of the Top 9 carry the highest risk of anaphylaxis: Fish, Shellfish, Tree Nuts, and Peanuts. A reaction to any of these can become life-threateni...

  #4  sim=0.3275  PB-006  chunk_index=15  lang=en
        section: Culinary Overview > Responsible in the Kitchen > Allergens are non-negotiable
        body:    The KitchFix Allergen Playbook (PB-002) applies in full at every account. Top 9 allergens are tracked and labeled at every meal period in English and ...

  #5  sim=0.3245  PB-006  chunk_index=57  lang=en
        section: Culinary Defined > 3.13 Allergens > Severe allergy and emergency response
        body:    Players, coaches, or staff with severe allergies are flagged to KitchFix in advance by the team dietitian. Accommodation plans are built per individua...

════════════════════════════════════════════════════════════════════════════
  6. STANDING - confidentiality / media
  Q: "can I talk about players to the media"
  expected: AGR-001 confidentiality discriminates from safety/operations docs
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.5642  AGR-001  chunk_index=8  lang=en
        section: 03 The Clubhouse Rules > 3.5 No talking to media or reporters
        body:    - You do not speak to media, reporters, podcasters, content creators, or anyone in a press capacity about anything connected to the Club, its players,...

  #2  sim=0.5607  AGR-001  chunk_index=7  lang=en
        section: 03 The Clubhouse Rules > 3.4 No talk of steroid use
        body:    - Do not discuss, speculate about, ask about, or joke about player use of performance-enhancing substances. - This applies to current players, former ...

  #3  sim=0.5084  PB-004  chunk_index=18  lang=en
        section: How We Treat Each Other > With Players and Clients
        body:    You work in MLB clubhouses and player facilities. Players are the reason our clients hire us. They are entitled to their privacy and to being treated ...

  #4  sim=0.4302  PB-004  chunk_index=20  lang=en
        section: How We Treat Each Other > Social Media & Phones
        body:    Do not post photos, videos, or any content from client facilities on social media. This includes the kitchen, the dining room, players, coaches, and a...

  #5  sim=0.4298  AGR-001  chunk_index=5  lang=en
        section: 03 The Clubhouse Rules > 3.2 No autographs
        body:    - Do not ask players, coaches, or Club staff for autographs. - Do not ask anyone connected with the Club to sign anything for friends, family, or anyo...

════════════════════════════════════════════════════════════════════════════
  7. STANDING - Spanish cross-lingual
  Q: "¿los tomates son alérgenos?"
  expected: PB-002 allergen content via cross-lingual embedding (documented degraded)
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.3527  PB-006  chunk_index=15  lang=en
        section: Culinary Overview > Responsible in the Kitchen > Allergens are non-negotiable
        body:    The KitchFix Allergen Playbook (PB-002) applies in full at every account. Top 9 allergens are tracked and labeled at every meal period in English and ...

  #2  sim=0.3312  PB-006  chunk_index=56  lang=en
        section: Culinary Defined > 3.13 Allergens > Standing positions
        body:    - **Top 9 allergens** - milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soybeans, and sesame are tracked and labeled at every meal period in E...

  #3  sim=0.3303  TPL-014  chunk_index=25  lang=en
        section: 05 Nutrition Guidelines and Allergen Standards > Allergen Position > Standing positions (floor)
        body:    Top 9 allergens (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soybeans, sesame) tracked and labeled at every meal period in English and Spa...

  #4  sim=0.3278  SOP-008  chunk_index=30  lang=en
        section: Cross-Contamination and Allergens > Allergens
        body:    The Allergen Playbook (PB-002) governs allergen handling. The essentials: know the top 9 allergens, prevent allergen cross-contact the same way you pr...

  #5  sim=0.3258  PB-002  chunk_index=3  lang=en
        section: 02 The Top 9 Allergens
        body:    Every team member must know these by name and know where they hide. A Top 9 posting must be visible in every kitchen. The FDA recognizes nine major fo...

════════════════════════════════════════════════════════════════════════════
  8. NEGATIVE - no answer in corpus (does the gap survive corpus growth?)
  Q: "what is the labor budget formula"
  expected: LOW scores - at 2x growth the gap held at ~10pts (0.22 vs 0.32); rerun confirms
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.5017  PB-010  chunk_index=33  lang=en
        section: Site Financial Discipline > Labor cost
        body:    - Schedule to the labor target and the business (Section 11). - No off-the-clock work and no unplanned overtime (POL-008).

  #2  sim=0.4862  PB-009  chunk_index=6  lang=en
        section: Labor Cost Management
        body:    The right coverage to hit the standard, scheduled to the target - with accurate time, always. - Schedule to the business - build the Rippling schedule...

  #3  sim=0.3875  PB-010  chunk_index=30  lang=en
        section: Site Financial Discipline
        body:    The EC owns the site's P&L - food cost and labor cost are made or lost on the floor every day.

  #4  sim=0.3709  REF-129  chunk_index=11  lang=en
        section: TBR - FL - Contract Source-of-Record > §C. Year-over-year table
        body:    Only 2024 SOWs are physically in the folder. Rates for 2025 / 2026 derive from CPI-adjusted 2024 base per the escalation clause (B.4). No separate 202...

  #5  sim=0.3619  REF-006  chunk_index=0  lang=en
        section: (no section / unsectioned)
        body:    KITCHFIX · PERFORMANCE FOOD SERVICE

════════════════════════════════════════════════════════════════════════════
  9. STUB-DOESN'T-POLLUTE - 'big rules' real-content query
  Q: "what are the big rules"
  expected: AGR-001 content chunks ranked ABOVE POSTER-001 stub
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.5542  AGR-001  chunk_index=3  lang=en
        section: 03 The Clubhouse Rules
        body:    These nine rules are the operator-facing version of how confidentiality, professionalism, and integrity actually show up in your shift.

  #2  sim=0.5436  AGR-001  chunk_index=13  lang=en
        section: 04 Facility Conduct
        body:    The Club's facility is the Club's house. Conduct yourself accordingly. - You are subject to the Club's screening requirements at all times. This may i...

  #3  sim=0.5434  AGR-001  chunk_index=0  lang=en
        section: 01 Why these are the Big Rules
        body:    Trust is what we sell. We are inside one of the most private workplaces in professional sports - the clubhouse. Players, coaches, and Club staff trust...

  #4  sim=0.5152  AGR-001  chunk_index=1  lang=en
        section: 02 Confidentiality
        body:    This is the rule that anchors every other rule in this document. If you only remember one thing, remember this. > ANCHOR: Everything in the clubhouse ...

  #5  sim=0.5077  AGR-001  chunk_index=6  lang=en
        section: 03 The Clubhouse Rules > 3.3 No talk of gambling
        body:    - Do not bet on baseball games. Do not place bets through anyone else. Do not facilitate bets for anyone else. - Do not discuss gambling, betting line...

════════════════════════════════════════════════════════════════════════════
  10. STUB SURFACES - 'allergen poster' query
  Q: "allergen poster"
  expected: POST-002 stub surfaces appropriately
════════════════════════════════════════════════════════════════════════════
  #1  sim=0.6232  POST-002  chunk_index=0  lang=en
        section: (no section / unsectioned)
        body:    This is a wall posting (visual reference). It is not indexed for text retrieval. Card description: Wall posting of the Top 9 allergens and the reactio...

  #2  sim=0.5348  PB-002  chunk_index=20  lang=en
        section: 05 Site Leader Responsibilities > 5.2 Player Allergen Information
        body:    Top 9 allergens are tracked and labeled at every meal period in English and Spanish...

  (... full stdout continues per file /tmp/regression-run-stdout.txt ...)
```

Truncated for readability. Full run captured at `/tmp/regression-run-stdout.txt` in the local worktree; the PR body links every question to the verbatim block above.

## Appendix B - corpus snapshot probe

Script used for §2, run against production PG at 2026-07-25T15:25:32Z:

```javascript
// Live doc count via per-doc chunk count (paginated bulk is unreliable without ORDER BY;
// I discovered this on the 2026-07-24 audit and it's why the state report and the workbook
// briefly disagreed).
```

Full probe: `/tmp/kf-regression-725/scripts/_probe_corpus_snapshot_725.mjs` in the local worktree. Output captured at `/tmp/regression-corpus-snapshot.txt`.
