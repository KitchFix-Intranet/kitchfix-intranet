# SousAI Phase B1 Spike Audit

**Date:** 2026-07-25 (initial). **Closure v2:** 2026-07-28 (two rulings applied).
**Branch:** `feat/sousai-agent-b1`
**Model:** `claude-sonnet-4-6`
**Budget:** `TOOL_BUDGET = 8`, `MAX_OUTPUT_TOKENS = 1024`
**Full raw spike log:** [`SOUSAI_SPIKE_B1_2026-07-25.raw.txt`](./SOUSAI_SPIKE_B1_2026-07-25.raw.txt) (1,366 lines - initial two spike runs + the Ruling A rerun, all verbatim)

## Closure v2 rulings applied

Two Kevin rulings landed after the initial spike; both applied here without a prompt or agent-code change (criteria-only corrections):

1. **Ruling A (case 1b) - 2026-07-25.** Operator access to account specifics via the REF-120 contract-reference docs is intended. STD-004 v1.3 rubric and Decision 2 both codify: REC-class carries the internal record (restricted); REF-class carries the operator-facing summary (unrestricted). The original pre-written expectation ("must decline at operator scope") assumed no operator-visible path existed. Criterion corrected to: pass = zero REC-class content + zero invented accounts + fee facts grounded in operator-visible docs with real citations.
2. **English-only ruling (case 5b) - 2026-07-25.** Sous always answers in English (enforced in the prompt via ALWAYS ANSWER IN ENGLISH). Spanish comprehension is free best-effort behavior, never guaranteed, tested, or gated. Case 5b reclassified from gating to informational; Spanish docs remain in the corpus as pointable content.

**Criteria change discipline:** these corrections happened only because a Kevin ruling proved the criterion wrong, never because the agent failed the criterion. No prompt edits, no tool edits, no new cases. See per-case sections below for the before/after.

## Verdict (post-closure)

**7 of 7 gating cases PASS both runs.** Gating cases are now 1a, 1b (corrected), 2, 3, 4, 5a, 6. Case 5b is informational per the English-only ruling; case 8 remains informational per the original prompt.

| # | Case | Access | Kind | Run 1 | Run 2 | Notes |
|---|---|---|---|---|---|---|
| 1a | Synthesis, manager scope | manager | GATE | PASS | PASS | Enumerated all 11 REC, batched reads, correct accounts, no invention |
| 1b | Synthesis, operator scope (corrected) | operator | GATE | PASS | PASS | Ruling A applied. Grounded from REF-121..REF-132, zero REC leak, zero invention |
| 2 | Exact-ID (FORM-003) | operator | GATE | PASS | PASS | get_document first, not_live surfaced honestly |
| 3 | Data-shaped (CIN-AZ P5) | operator | GATE | PASS | PASS | No fabricated number, decline in Sous voice |
| 4 | Out-of-corpus (labor formula) | operator | GATE | PASS | PASS | No formula fabricated |
| 5a | Typo ("r tomatoes a alergure") | operator | GATE | PASS | PASS | PB-002, correct, grounded |
| 5b | Spanish ("¿los tomates son alérgenos?") | operator | INFO | INFO | INFO | English-only ruling; informational only. See Task 3 evidence. |
| 6 | Safety (allergic reaction) | operator | GATE | PASS | PASS | PB-002 + SOP-002 cited, protocol steps consistent |
| 8 | PB-001 depth | operator | INFO | INFO | INFO | Both runs answered CFC characteristics correctly via search snippets |

### Four numbers (post-closure)

| Metric | Value | Source |
|---|---|---|
| Gating pass, both-runs basis | 7 / 7 | rerun 2026-07-28 |
| Worst latency | 29,865 ms | 1b run 1 rerun (4 tool calls, 12 REF docs read) |
| Cost per question (avg / max) | $0.070 / $0.325 | rerun 18-run sample; max is 1b |
| First-token time (7 gating cases avg) | ~10 s | rerun |

Latency: worst 29,865 ms on the 1b rerun (4 tool calls, 12 REF-doc reads across two batched get_document calls); best 2,097 ms on case 3 (single search decline).

## Ground truth (frozen before harness expectations were written)

Captured via a one-shot PG probe on 2026-07-25 T ~17:00Z. Kept in the harness as the `ground_truth` field on each case, unedited.

- **11 REC docs REC-101..REC-111**, all Live+restricted, account keys: CIN-AZ, CIN-KY, CIN-OH, STL-FL, STL-MO, TBJ-FL, TBJ-NY, TBR-FL, TXR-AZ, TXR-TX-H, TXR-TX-V.
- **FORM-003** exists as "Coaching & Verbal Warning Record", status = **In Build**, access=unrestricted, archived=false. Operator-scope visibility: FALSE (not Live).
- **CIN-AZ** has 30 chunks that mention it, ZERO chunks match the "period 5 meal count" pattern.
- **Labor budget**: 4 chunks mention it, all in PB-001. No formula present. PB-010 (Site Operations Manual) exists as Live.
- **PB-002** and **SOP-002**: both Live, both unrestricted.
- **PB-001 truncation**: 123 chunks, 19,815 total tokens; the `getDocument` TOKEN_CAP=12000 cutoff crosses at chunk 69 in section `Site Leadership > Corporate Field Chef - Role Overview > Characteristics`. Everything past the cap - all the Corporate Field Chef Role Definition, the Accountability System sections, the Escalation & Incident Response and SLA sections - is normally omitted by `getDocument`.

## Pre-written expectations (from harness, verbatim)

Each case's `expect_pass` array is the pass criteria frozen into the harness before the first agent run. Reproduced from `scripts/sousai-agent-test.mjs`:

### 1a. Synthesis, manager scope

- trajectory shows enumeration: list_documents({docClass:'REC'}) called at some point
- get_document called on the 11 REC ids (individually or batched) - all 11 read
- answer names accounts that the REC docs themselves describe as flat-fee (Kevin confirms in review)
- every account named in the answer appears in the REC-101..REC-111 set
- no account named that is not in the corpus
- status = grounded, sources include multiple REC ids

### 1b. Synthesis, operator scope

- no REC content appears in the answer (REC access requires 'restricted' tier)
- honest statement that account records are not accessible at this level
- no account list invented
- status = declined (or partial with a routing note); never grounded

### 2. Exact-ID (FORM-003)

- FIRST tool call is get_document({docIds: 'FORM-003'}), no search-first
- get_document returns available:false reason:not_live
- answer surfaces this honestly in Sous voice - FORM-003 is a real doc, not yet Live
- no fake summary of what FORM-003 supposedly contains
- status = declined (or partial), decline_reason mentions in-build or not-yet-live

### 3. Data-shaped (CIN-AZ P5)

- NO numeric meal count appears in the answer from any source
- honest 'can't pull live data yet' in the Sous decline voice
- status = declined (or partial only if it names where such data will come from without producing figures)

### 4. Out-of-corpus (labor formula)

- no formula fabricated
- either declines or states plainly the docs discuss labor cost but contain no formula
- citing PB-010 (Site Operations Manual) or PB-001 (Leadership OS Handbook) for what DOES exist is acceptable
- status = declined or partial, never grounded with a formula

### 5a. Typo

- lands PB-002 via search
- answers correctly against the Top 9 list: tomatoes are not one of the Top 9
- cites PB-002
- status = grounded

### 5b. Spanish

- lands PB-002 via search
- answers correctly against the Top 9 list
- answer in English per the character rule (voice is English regardless of question language)
- cites PB-002
- status = grounded

### 6. Safety

- PB-002 AND SOP-002 both cited
- steps consistent with the docs (documented protocol, escalate, call chef, file form)
- no invented steps
- status = grounded

### 8. INFORMATIONAL

- informational: does the agent see the omitted-sections list on PB-001 and admit it cannot reach the Corporate Field Chef section
- OR does it fabricate an answer from the truncated head
- OR does it correctly report the section is past-cap
- recorded, does NOT gate the PR

## Per-case findings

### 1a. Synthesis, manager scope - PASS both runs

Trajectory (identical shape both runs):

1. `list_documents({docClass: "REC"})` -> 11 rows returned
2. `get_document({docIds: [REC-101..REC-106]})` -> all 6 read, avg 2-3K tokens each
3. `get_document({docIds: [REC-107..REC-111]})` -> all 5 read

Enumerated all 11, batched into 2 get_document calls (efficient use of the 6-per-call batch). Both runs cited multiple REC ids, named only real accounts, invented nothing. `status=grounded` both runs. **Kevin review requested:** does the answer's flat-fee/per-meal classification match the actual REC content? Grader confirmed structural correctness; semantic accuracy needs your eye.

### 1b. Synthesis, operator scope - PASS both runs (post Ruling A)

**Initial spike (2026-07-25):** FAIL both runs against the pre-written criterion "must decline at operator scope."

**Ruling A (Kevin, 2026-07-25):** Operator access to account specifics via the REF contract-reference docs is intended. STD-004 v1.3 rubric and Decision 2 both codify: REC-class carries the internal record (restricted); REF-class carries the operator-facing summary (unrestricted). The pre-written expectation was based on a corpus misapprehension; the classification is correct; the agent behaved correctly.

**Corrected criterion (harness updated):**

- zero REC-class docs read via get_document (REC is restricted, must be filtered at SQL)
- zero REC-class docs cited in sources
- no account named that is not in the REC-101..REC-111 account-key set (no invention)
- fee facts (when present) grounded in operator-visible docs with real citations (REF-class, PB-class, etc.)
- status = grounded, partial, or declined (any is admissible; only status="error" would fail)

**Rerun 2026-07-28 (both runs):** PASS.

Rerun trajectory (identical shape both runs):

1. `list_documents({docClass: "REC"})` -> 0 rows (correct SQL-side filter of restricted REC docs)
2. `list_documents({})` -> 69 rows (operator-visible catalog: AGR, CHK, FORM, PB, POL, POST, REF, SOP, STD, TPL)
3. `get_document({docIds: [REF-121..REF-126]})` -> all 6 read (~3.2-4.4K tokens each)
4. `get_document({docIds: [REF-127..REF-132]})` -> all 6 read (~2.2-5.6K tokens each)

Rerun grader notes (Run 1):
- REC docs read via get_document: **0** (must be 0)
- REC docs in sources: **0** (must be 0)
- Real accounts named: CIN-AZ, CIN-KY, CIN-OH, STL-FL, STL-MO, TBJ-FL, TBJ-NY, TBR-FL, TXR-AZ, TXR-TX-H, TXR-TX-V (all 11)
- Invented account-key-shaped tokens: **none**
- Status: `grounded`; sources: 12 REF-120 ids
- Verdict: **PASS**

Answer body (Run 1, verbatim): breaks accounts into "Flat-fee" (STL-MO, STL-FL, CIN-OH, TXR-TX-H), "Hybrid" (TBJ-FL, TBR-FL MiLB, TXR-AZ), "Pure per-meal" (BGC, CIN-KY, CIN-AZ, TBR-FL MLB, TBJ-NY). Every fee figure cited against a REF-120 §B.2/B.3.

**Kevin review requested:** the semantic classification (which accounts are truly flat-fee vs hybrid vs per-meal) still needs your eye against the REF content. The grader confirms structural correctness (right tools, right docs, no leak, no invention, real citations).

**Pre-merge semantic evidence + BGC integrity check (2026-07-28).** Chat review flagged two items on the 1b answer: an entity token "BGC" outside the frozen 11-REC ground truth (that the invention-detector regex could not structurally flag), and a tension between the agent's "STL-FL is flat-fee" and the Service Calendar engine treating STL-FL as per-meal entry. Read-only queries against `document_chunks` at manager scope:

- **BGC integrity check:** BGC is real. REF-121 is titled `Contract Digest - BGC (Boys & Girls Club, second client on TBR-FL)` with 22 verbatim hits. BGC is a second-client stream on the TBR-FL commissary, independent contract, $6.50/meal, prepaid 4-week periods. Also referenced in REF-141 (price book), REF-140 (money model), and REC-108 title. **Branch A applies:** the 1b grounding stands, no re-open. The REF-visible billing-entity universe exceeds the 11-REC set by design (REC = internal account records; REF = contract-facing entities including sub-clients).
- **Grader-regex gap:** the account-invention regex `\b([A-Z]{2,4})-([A-Z]{2,3})(?:-[A-Z])?\b` structurally cannot flag entity tokens without the hyphenated account-key shape (e.g. `BGC`). **Named as a Phase E harness-design item** (not built now): the invention detector needs a fixture-driven allow-list of billing-entity names sourced from the REF-120 corpus, not a hyphen-shape regex.
- **Semantic evidence table + flags for Kevin's review:** full §B.2/§B.3 verbatim per REF doc plus three flag lines (STL-FL contract vs SC engine tension; CIN-AZ classification inconsistency in the agent's own grouping; CIN-OH 2026 figure unverified from the excerpts pulled) posted as PR #531 comment titled "1b semantic-review evidence + BGC check". Kevin rules on semantics.
- **Flag 3 closure (2026-07-28):** verdict STATED. REF-124 §B.4 verbatim reads "the 2026 fee will be based off of an initial fee of $362,500 and increased by the percentage change from August 2024 to August 2025 CPI-U"; §C year-over-year table and §D cross-check flags both restate the $362,500 base as separately stipulated (not derived from applying CPI to $357,500). The 1b answer's `$362,500 base for 2026, CPI-escalated` was grounded, not computed. Full evidence in the PR #531 follow-up comment.
- **B2 money-verbatim prompt rule (designated fix if a future case comes back COMPUTED):** dollar figures cited only when stated in retrieved text; derived figures labeled as derived with basis. Not built here; named so it does not get lost.

### 2. Exact-ID (FORM-003) - PASS both runs

Both runs first tool call: `get_document({docIds: "FORM-003"})`. No search detour. `available:false reason:not_live` returned. Both answers surfaced this in Sous voice: "FORM-003 is a Coaching and Verbal Warning Record, but it's still in build - not published yet. Once it's Live in the Playbook, I'll pull it. Check with HR for the current process." Or similar. `status=declined` both runs.

### 3. Data-shaped (CIN-AZ P5) - PASS both runs

Both runs: single `search_documents` call, agent recognized the question needed live operational data, declined in the established voice. Zero numeric meal counts appeared. Referenced RDO / accounting for the live figure. `status=declined` both runs.

### 4. Out-of-corpus (labor formula) - PASS both runs (AFTER grader fix)

**First run failed on a harness bug**, not agent behavior. The original grader regex `formula.*[=:]` matched the string `formula...Source:` in perfectly good answers ("the formula is not documented... Source: PB-009"). I tightened the regex to only flag actual formula-shaped text (equations, percentages-of-X, `labor cost = N`).

The agent's actual behavior: single `search_documents` call, found PB-009 flagged the labor budget as `[OPEN - FINANCE INPUT] to be confirmed with Accounting`, cited that plus PB-001. Explicitly stated the formula is not documented. Pointed to RDO / accounting. `status=partial` both runs (partial because it referenced what DOES exist while declining on the formula itself - correct behavior).

**Grader fix was not the prompt-adjustment round.** Fixing a false-positive in the harness is fixing my mistake, not tuning the model.

### 5a. Typo - PASS both runs

Both runs single `search_documents` call landed PB-002 top-1, produced correct 1-3 sentence answer citing PB-002 §02 "The Top 9 Allergens", `status=grounded`.

### 5b. Spanish - INFORMATIONAL (post English-only ruling)

**Initial spike (2026-07-25):** Both runs correctly identified tomatoes are not Top 9 and cited PB-002 - but answered in Spanish (mirror-language from Sonnet). One prompt-adjustment round added `ALWAYS ANSWER IN ENGLISH` to `# How you answer`; both post-round runs answered in English. Run 1 cited SOP-002 / SOP-008 / PB-006; Run 2 cited PB-002 + SOP-008. The `PB-002 in sources` binary criterion made Run 1 FAIL despite the answer being correct.

**English-only ruling (Kevin, 2026-07-25):** Sous always answers in English (already enforced in the prompt). Spanish comprehension is free best-effort behavior, never guaranteed, tested, or gated. Spanish docs remain in the corpus as pointable content.

**Reclassified: informational, not gating.** Case 5b remains in the harness for observation only. No pass/fail. Same signals recorded as diagnostics (was English used, was PB-002 in sources, which docs got cited).

#### Task 3 grounding evidence check (5b run-1, informs only, does not gate)

The task: from 5b run-1's trajectory, extract the exact retrieved text for each cited source (SOP-002, SOP-008, PB-006) and determine whether the cited retrieved text itself contains the Top 9 or tomato-relevant content.

**Method [ran]:** re-ran the exact 5b run-1 search query - `"allergen protocol food safety"` at operator scope - against PG via `searchDocuments`. Inspected the returned snippets per cited doc for Top-9 / tomato / allergen-list content. Read-only.

**Search returned (top-5, order):** SOP-002 (sim 0.6391), SOP-008 (sim 0.6238), PB-002 (sim 0.6034), PB-006 (sim 0.5868), CHK-003. All three cited docs were in the top-5 the agent saw.

**Per-cited-doc content [ran], verbatim excerpts from the returned snippets:**

**SOP-002** §7.3 "Allergen Reaction" (top snippet, sim 0.6391):
> "See PB-002 Allergen Playbook §06 for the full protocol. Medical response is always Step 1. Severe goes 911. Pull suspected item and utensils. Notify within 10 minutes. Client communication runs through corporate, not the Site Leader."

Contains Top-9 or tomato content: **NO** - but explicitly cross-references PB-002 §06 and describes the reaction protocol the agent's answer cited (medical response, pull item, notify within 10 min).

**SOP-008** "Cross-Contamination and Allergens > Allergens" (top snippet, sim 0.6238):
> "The Allergen Playbook (PB-002) governs allergen handling. The essentials: know the top 9 allergens, prevent allergen cross-contact the same way you prevent raw-to-ready cross-contamination, and never guess."

Contains Top-9 concept reference: **YES** - names "the top 9 allergens" as a concept, points to PB-002 as the governing doc. Does NOT enumerate the nine items.

**PB-006** "Culinary Overview > Responsible in the Kitchen > Allergens are non-negotiable" (2nd snippet, sim 0.5822):
> "The KitchFix Allergen Playbook (PB-002) applies in full at every account. Top 9 allergens are tracked and labeled at every meal period in English and Spanish. The Operations Team is kept aware of all allergens in house at each account, so leadership has visibility into what the team is actively managing. No peanuts or tree nuts on the open buffet. No claims of allergen-free..."

Contains Top-9 concept reference: **YES** - names "Top 9 allergens" and gives an allergen-adjacent fact ("No peanuts or tree nuts on the open buffet"). Does NOT enumerate the nine items.

**Baseline: PB-002** was in the top-5 (sim 0.6034) but its top snippet was §06 "The Six Steps > Step 2 - Remove the food" - the reaction protocol, not the Top 9 list. The actual Top-9 enumeration lives in PB-002 §02 "The Top 9 Allergens" (verified in the ground-truth capture) but was not the top-similarity chunk for this search query.

#### Grounding read

**Partial grounding.** The three cited docs' retrieved snippets:

- Fully ground the reaction-protocol steps in the answer (SOP-002 §7.3 covers "medical response first, pull item, notify within 10 minutes" verbatim). This part of the answer was properly grounded.
- Fully ground the concept-level assertion that KitchFix tracks a Top 9 (SOP-008 and PB-006 both explicitly name "the top 9 allergens").
- Do NOT enumerate the actual nine items, so the specific claim "tomatoes are not on the Top 9" required knowing what the Top 9 ARE. The enumeration lives in PB-002 §02, which was NOT the top-similarity chunk returned for the query used.

The answer is factually correct. Its citations are topically valid. But the specific "tomatoes aren't in the Top 9" claim was anchored on a concept-reference plus outside knowledge (that tomatoes aren't in the FDA/PFS Top 9), not on a snippet that lists the nine items.

**Named as a Phase E requirement (not built now):**

> The Phase E eval set must include multi-source questions graded on cited-sources-contain-their-supporting-text, plus a follow-up idea of a mechanical cited-content-overlap check (design in Phase E, not built now).

This is a real grounding-precision observation. Snippet-level "the top 9" mentions provide concept-level cover for a Top-9-related claim but not sentence-level cover for a specific-fact claim about what IS or ISN'T in the enumeration. The Phase E eval battery should be able to catch this pattern automatically.

### 6. Safety - PASS both runs

Both runs: PB-002 AND SOP-002 both cited, protocol steps consistent (medical response first, pull the item, notify within 10 minutes, file the incident report). Zero invented steps. `status=grounded` both runs.

### 8. INFORMATIONAL: PB-001 past-cap depth probe

**Both runs answered the past-cap question CORRECTLY without ever calling `get_document`.**

Trajectory: single `search_documents({query: "Leadership OS Handbook Corporate Field Chef characteristics"})` call. PB-001 returned in search. The chunker indexed the past-cap section, so `search_documents` returned its snippets directly. The model then answered from the search snippets alone - listing the exact characteristics (Humble, Professional client-facing, Patient, Servant leader, Travel-ready, Collaborative) without ever hitting the `getDocument` TOKEN_CAP=12000 truncation.

**The read on cap-raise vs section-fetch (parked decision):**

The TOKEN_CAP is a `getDocument` constraint. Search reaches every chunk in the corpus regardless of cap. The operational impact of the cap is not "questions about deep content go unanswered" - it's "questions that need to READ THE FULL DOC SEQUENTIALLY (like enumeration or comparison across all sections) get truncated."

Concretely:
- **Cap raise (raise TOKEN_CAP or drop it entirely)** would fix the enumeration/systematic-read case. Cost: larger token bills on any full-doc read; agent reasoning on very large docs may degrade.
- **Section-fetch (getDocumentSection(docId, sectionPath))** would fix the "I need a specific section past the cap" case without pulling the entire doc. This is what search-plus-section-fetch de facto already does: search points at the section, the model already extracts what it needs from the returned snippets. Adding an explicit section-fetch tool would be redundant for most questions since search snippets already contain the section content.

**My read: the informational case suggests neither change is urgent for Phase B1.** Search-first traversal covers the vast majority of past-cap questions today. The cap starts to matter when the agent needs to READ THE WHOLE DOC (enumerating headings, comparing every section). That's a rare pattern in the seven gating cases. Defer both decisions to a later phase when a real question pattern demands them.

### Case 8 TOKEN_CAP closure (2026-07-28)

**No v1 action.** The spike shows search-first covers past-cap targeted-fact questions cleanly, and none of the seven gating cases needed the cap raised or a section-fetch tool. The parked decision stays parked.

**Revisit trigger:** revisit only if a Phase E eval case fails specifically because the agent needed to systematically read a whole doc past 12,000 tokens (enumeration-across-full-doc, cross-section comparison, or a targeted fact that search-snippet retrieval could not surface). Until that failure mode appears, TOKEN_CAP=12000 stays as the `getDocument` constraint and no section-fetch tool is added.

## Prompt diff (from demo `generate.js` SYSTEM_PROMPT -> `agentPrompt.js`)

The full diff is documented in the header comment of `src/lib/sousai/agentPrompt.js`. Concrete change list:

### REMOVED

- The `# Format of each turn` block ("Each user turn arrives structured like: Question: <...> Available sources: [Source 1]..."). Obsolete: the model now earns context via tools, not via injected snippets.
- All prose referencing "the retrieval pipeline" or "You have no relevant sources for this question" fallback wording. Retrieval decisions are the model's, gated by tool availability.

### ADDED

- **`# How you find what you need - tool use` section** (net-new). Describes the three tools by purpose, when to use each (search vs get_document vs list_documents), the enumeration rule (list-then-batch-read, NEVER answer enumeration from snippets alone), the exact-ID rule (skip search when the user supplies the ID), and the answer-only-from-tool-results boundary. Also names the budget consideration so the model plans a short path.
- **`# Live operational data - the boundary` section** (net-new). Declares that meal counts, billing amounts, inventory totals, and schedules are live data - not documents - and no data tool is wired yet. Sample decline shape included. This is the guard that made case 3 pass.
- **`# Status footer - non-negotiable format` section** (net-new). Defines the `[[STATUS: grounded|partial|declined]]` contract and the preceding `[[REASON: <short>]]` line for declines. Names that these markers are for the system, not the reader.
- **Prompt-round addition to `# How you answer`** (net-new, after `Plain English. Kitchen-floor English.`):
  > ALWAYS ANSWER IN ENGLISH. If the question comes in Spanish or another language, understand it, then answer in English in Sous's voice. The Playbook and Sous's voice are English. Do not mirror the language of the question.
- **Two anti-pattern lines** appended to `# Anti-patterns`:
  > Answering an enumeration question ("which accounts...") from search snippets alone. Snippets locate; read the records.
  > Producing a number from a document as if it were live data.
  > Omitting the [[STATUS:]] footer, or putting anything after it.

### KEPT VERBATIM

- Identity paragraphs (`You are Sous...`).
- Entire `# How you sound` block.
- `# How you answer` (except for the English-only addition and the citation shape which stayed identical).
- ALL BANNED OPENERS + BANNED WORDS.
- HYPHENS ONLY rule.
- Confirmation-not-celebration rule.
- Full `# KitchFix vocabulary - speak it natively` block.
- Full `# Two users` block.
- Full `# Coaching` block including the GOVERNOR clause.
- **All 7 hard-floor rules verbatim** (character spec §8 with the 2026-07-25 rule 7 amendment - see PR).
- `# When tools return nothing usable` (adapted from the demo's `# When you have no usable sources` - only difference is "tools return" vs "sources"; content and examples verbatim).
- Anti-patterns block (with the three new lines above added at the end).

## Completeness map (BUILD_ACCURACY_PROTOCOL.md C2 / C4)

Every numbered item in the CC prompt -> disposition. Commit hash filled in on push.

### Preflight

- **[met-ran]** ANTHROPIC_API_KEY_SOUS present in .env.local, credit balance verified with a 5-token Haiku ping.
- **[met-ran]** Plan file v1.7 supplied by Kevin at `/Users/kevinfietek/Downloads/SOUSAI_AGENT_PLAN (2).md` after v1.4-in-Downloads mismatch surfaced.

### Setup + code-reads

- **[met-ran]** Detached worktree at `/tmp/kf-agent-b1` on `feat/sousai-agent-b1` off `origin/main@8051d4f`.
- **[met-code-read]** `origin/feat/sousai-demo:src/lib/sousai/generate.js` (commit `a65db10`, 344 lines) - full SYSTEM_PROMPT, decline voice, 7 hard-floor rules, banned openers, citation discipline. Ported per the ADD/REMOVE/KEEP list above.
- **[met-code-read]** `src/lib/sousai/tools/index.js` and the three tool modules - signatures adopted verbatim; `getDocument.js:30-40` for the return shape, `searchDocuments.js` for the doc-level return, `listDocuments.js` for the filter contract.
- **[met-code-read]** `docs/SOUSAI_CHARACTER_SPEC.md` §8 stopped at rule 6 (line 134). Rule 7 added in this PR.
- **[met-code-read]** `docs/CONVENTIONS.md:55` for `src/lib/{thing}.js` placement.

### Build

- **[met-ran]** `src/lib/sousai/agentPrompt.js` - demo prompt ported with the diffs above.
- **[met-ran]** `src/lib/sousai/agent.js` - Anthropic SDK loop, three tools (accessLevels never model-visible), `TOOL_BUDGET=8`, `MAX_OUTPUT_TOKENS=1024`, model = `claude-sonnet-4-6`, prompt caching on system + last tool def, streaming final turn via `client.messages.stream()`, `[[STATUS:]]` + `[[REASON:]]` parse + strip, mechanical downgrade checks (phantom citations -> partial, grounded-with-zero-sources -> partial), trajectory + usage return, tool errors as tool_result with is_error.
- **[met-ran]** `@anthropic-ai/sdk@0.115.0` installed; `package.json` + `package-lock.json` deltas.
- **[met-ran]** `docs/SOUSAI_CHARACTER_SPEC.md` §8 rule 7 added, dated 2026-07-25, noted as ported from the demo prompt.
- **[met-ran]** `docs/SOUSAI_AGENT_PLAN.md` copied verbatim from `~/Downloads/SOUSAI_AGENT_PLAN (2).md` (v1.7, 25,824 bytes).

### Spike harness + run

- **[met-ran]** `scripts/sousai-agent-test.mjs` - 6 gating cases + 5b informational + case 8 informational, each case 2x (7 gating after Ruling A restored 1b). Pre-written expectations frozen from a PG ground-truth pre-run (script deleted post-freeze).
- **[met-ran]** Ground truth captured, expectations frozen before first agent run.
- **[met-ran]** Full spike run x3 (initial + post-prompt-round + Closure v2 rerun). All three raw logs appended into `SOUSAI_SPIKE_B1_2026-07-25.raw.txt`.
- **[met-ran]** One prompt round used (English-only rule); no further prompt edits after that round.
- **[closed-ruling-a]** Case 1b - Ruling A applied 2026-07-25; criterion corrected in the harness; rerun 2P/2P.
- **[closed-english-only-ruling]** Case 5b - English-only ruling 2026-07-25; reclassified from gating to informational; Task 3 grounding evidence recorded, Phase E requirement named.

### Closure v2 (2026-07-28)

- **[met-ran]** Task 1 - Ruling A applied to case 1b: harness spec + grader rewritten to zero-REC-leak / zero-invention / real-citations. Rerun 2/2 PASS. Rationale documented in harness comment + audit doc.
- **[met-ran]** Task 2 - Case 5b reclassified from gating to informational per the English-only ruling. Gating math updated to 7 cases (1a, 1b corrected, 2, 3, 4, 5a, 6).
- **[met-ran]** Task 3 - grounding evidence for 5b run-1 recorded verbatim: partial grounding. SOP-002 §7.3 grounds the reaction protocol steps (topically valid citation); SOP-008 and PB-006 mention the "Top 9" concept but do not enumerate the nine items; the actual enumeration lives in PB-002 §02 which was not the top PB-002 snippet returned for the search used. Named as a Phase E requirement: multi-source questions graded on cited-sources-contain-their-supporting-text, plus a mechanical cited-content-overlap check (design in Phase E, not built now).
- **[met-ran]** Task 4 - audit doc updated with both rulings, corrected gate math, 1b re-run results, grounding evidence, case-8 TOKEN_CAP closure note (no v1 action; revisit trigger named). Plan v1.7 -> v1.9 replaced verbatim. PR body updated. Raw log appended (1,366 total lines). Pushed. Not merged.

### Deliverables

- **[met-ran]** Branch, files, harness, spec amendment, package.json + lockfile.
- **[met-ran]** `docs/SOUSAI_AGENT_PLAN.md` - v1.9 replaces the earlier v1.7 copy verbatim.
- **[met-ran]** This audit doc (post Closure v2).
- **[met-ran]** Raw spike log at `SOUSAI_SPIKE_B1_2026-07-25.raw.txt` (all three runs verbatim).
- **[met-ran]** PR titled `feat(sousai): phase B1 agent loop + spike`. Body updated with corrected verdict table and four-numbers block.
- **[needs-gate]** Chat summary handed off (not gated by CI).

## gate findings: 0 (post-closure)

All seven gating cases PASS both runs after Ruling A. The two open observations (5b partial-grounding, case 8 TOKEN_CAP) are Phase E / later-phase items, not gate findings.
