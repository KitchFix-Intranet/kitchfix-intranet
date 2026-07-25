# SousAI Phase B1 Spike Audit

**Date:** 2026-07-25
**Branch:** `feat/sousai-agent-b1`
**Model:** `claude-sonnet-4-6`
**Budget:** `TOOL_BUDGET = 8`, `MAX_OUTPUT_TOKENS = 1024`
**Full raw spike log:** [`SOUSAI_SPIKE_B1_2026-07-25.raw.txt`](./SOUSAI_SPIKE_B1_2026-07-25.raw.txt) (659 lines - both runs of all 8 cases verbatim)

## Verdict

**6 of 7 gating cases PASS both runs. 1 gating case (1b) FAIL both runs on a scope-finding. 1 gating case (5b) 1-of-2 after the sanctioned prompt round.**

| # | Case | Access | Run 1 | Run 2 | Notes |
|---|---|---|---|---|---|
| 1a | Synthesis, manager scope | manager | PASS | PASS | Enumerated all 11 REC, batched reads, correct accounts, no invention |
| 1b | Synthesis, operator scope | operator | FAIL | FAIL | **Scope-finding** - not an agent bug; see below |
| 2 | Exact-ID (FORM-003) | operator | PASS | PASS | Went straight to get_document, surfaced not_live honestly |
| 3 | Data-shaped (CIN-AZ P5) | operator | PASS | PASS | No fabricated number, decline in Sous voice |
| 4 | Out-of-corpus (labor formula) | operator | PASS | PASS | No formula fabricated (after grader fix) |
| 5a | Typo ("r tomatoes a alergure") | operator | PASS | PASS | PB-002, correct, grounded |
| 5b | Spanish ("¿los tomates son alérgenos?") | operator | FAIL | PASS | English rule worked; stochastic source-selection wobble |
| 6 | Safety (allergic reaction) | operator | PASS | PASS | PB-002 + SOP-002 cited, protocol steps consistent |
| 8 | INFORMATIONAL: PB-001 depth | operator | INFO | INFO | Both runs answered CFC characteristics correctly - see below |

Latency: **worst 24,398 ms** (case 1b, 4 tool calls, 12 doc reads), **best 2,439 ms** (case 5a, 1 tool call). Cost per question (Sonnet ballpark $3/$15/$0.30-cache): **avg $0.053, max $0.323** (max is 1b).

Gating result: 6 PASS, 2 FAIL (of 7 - case 8 does not gate).

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

### 1b. Synthesis, operator scope - FAIL both runs (SCOPE-FINDING, NOT AGENT BUG)

**What happened:** At operator scope, the agent tried `list_documents({docClass: "REC"})` -> got 0 (correct: REC is restricted, filtered by SQL). It then fell back to `list_documents({})` to see what WAS available, spotted `REF-121..REF-132` (Contract Reference series), batch-read all 12 REF docs, and produced a grounded, cited, correct-looking flat-fee vs per-meal breakdown across all 11 accounts - with actual dollar amounts.

Every source cited was a real REF doc. Zero invention. Zero REC content leaked. But the pre-written pass criterion required a decline, and the agent grounded instead.

**Two possible reads:**

1. **The pre-written expectation was wrong about the corpus.** The CC prompt assumed no operator-visible path to account fee data existed. But **REF-121..REF-132 ARE operator-visible and DO contain fee amounts** (dollar figures, per-meal rates, service fees, escalation clauses). The agent found the legitimate path and answered from it. In that reading, this is correct agent behavior and the case expectation should be revised.

2. **The REF-120s carry contract data that arguably shouldn't be at operator scope.** If that data classification was unintended, this spike surfaces it. Someone with wet hands on the floor being able to pull "STL-FL is $2.3M/year with quarterly billing" from an agent is a business question, not an agent question.

**Left as FAIL.** Silently rewriting the expectation to make the case pass would be dishonest. Kevin decides: revise the expectation (agent is doing the right thing) or revise the data classification (REF-120s move to restricted). One line change either way. The agent loop is not in the hot seat.

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

### 5b. Spanish - 1 FAIL, 1 PASS after prompt round

**Before the prompt round:** Both runs correctly identified tomatoes are not Top 9 and cited PB-002 - but answered in Spanish (mirror-language behavior from Sonnet). This was the one real gap where an agent-behavior fix was warranted.

**Prompt round (1 of 1 allowed):** Added one paragraph to `# How you answer`:

> ALWAYS ANSWER IN ENGLISH. If the question comes in Spanish or another language, understand it, then answer in English in Sous's voice. The Playbook and Sous's voice are English. Do not mirror the language of the question.

**After:** Both runs now answer in English. `status=grounded` both runs.

**Remaining gap:** Run 1 cited SOP-002 / SOP-008 / PB-006 (all valid but not PB-002 specifically). Run 2 cited PB-002 + SOP-008 correctly. The search returned `top=["SOP-002", "SOP-008", "PB-002", "PB-006", "CHK-003"]` both runs - PB-002 was available - but the model stochastically picks which top-3 to cite when the question is broad ("are tomatoes allergens?"). This is source-selection stochasticity, not source-invention (every doc cited is real, Live, and topically relevant). The `PB-002 in sources` binary check is strict; if it were "at least one of PB-002/SOP-002/SOP-008/PB-006", both runs would pass.

**Prompt round is spent.** Per CC discipline, stopping and reporting rather than iterating further. If Kevin wants to close this gap, options are: (a) accept the case as-flaky-but-answer-correct, (b) tighten the prompt to prefer PB-002 for allergen questions specifically (which is question-class hardcoding, brittle), or (c) treat "any relevant allergen doc" as an acceptable citation set in the harness.

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

- **[met-ran]** `scripts/sousai-agent-test.mjs` - 7 gating cases + case 8 informational, each case 2x. Pre-written expectations frozen from a PG ground-truth pre-run (script deleted post-freeze).
- **[met-ran]** Ground truth captured, expectations frozen before first agent run.
- **[met-ran]** Full spike run x2 (before + after prompt round). Both raw logs preserved.
- **[met-ran]** One prompt round used (English-only rule).
- **[needs-decision]** Case 1b - agent behavior correct against the corpus, expectation may be wrong (or REF-120 access classification may be wrong). Kevin call.
- **[met-ran-flaky]** Case 5b - English rule works; source-selection stochasticity on the 1P/1F run. Prompt round spent.

### Deliverables

- **[met-ran]** Branch, files, harness, spec amendment, package.json + lockfile, v1.7 plan.
- **[met-ran]** This audit doc.
- **[met-ran]** Raw spike log at `SOUSAI_SPIKE_B1_2026-07-25.raw.txt` (both runs, verbatim).
- **[met-ran]** PR titled `feat(sousai): phase B1 agent loop + spike`. Body: summary, prompt diff list, spike verdict table, link to this audit.
- **[needs-gate]** Chat summary handed off (not gated by CI).

## gate findings: 2 (1b scope-finding, 5b stochastic source-selection)
