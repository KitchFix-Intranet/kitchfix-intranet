# Sous Testing Plan - ratified 2026-08-01

**Ratified by Kevin, same-day as the calibration round's 77.8% false-alarm finding.** Theme: check the answer, not just the plumbing. Each item names its mechanism and where it lands. This doc feeds the PR B prompt (harness sections), the next R-Chat digest update, and one standing calendar practice; it commits to `docs/` with whichever of those lands first.

## Tier 1 - the receipt check (gates PR B, non-negotiable)
**Every number has a receipt.** For every data answer in the eval set: extract each numeric figure from the answer text, assert it appears in that turn's tool payload rows. Catches hallucinated math, wrong-column reads, and - the reason it gates memory - numbers reused from conversation history instead of fresh tools. This is the parked re-query eval in its final form: the memory eval asks a follow-up numeric question and the receipt check proves the number came from the follow-up turn's own tool call. Closes the named Phase E gap (call-succeeded is not answer-follows).

**Fact-receipt extension (added 2026-08-04, calibration round 2).** The numeric extractor never sees names, doc ids, or account keys - exactly the class of fact the live 2026-08-03 sous-chef reproduction produced ("Adam Lacy" returned with a citation, zero tool calls, PARTIAL for the wrong reason). For eval cases flagged as fact-answers, the harness extracts named entities from the answer and asserts each appears in that turn's tool-payload text (a mechanical containment check against `JSON.stringify(rawResult)`, not an NLP extractor). Applied to the new M3 gate case (sous-chef fact lookup). Existing cases where the extension would flip a passing case are left alone and logged.

## Tier 2 - cheap guards (ride PR B's harness additions)
1. **No-plumbing check.** Maintain a list of internal identifiers (tool names, table/view names, env-var names). Any appearance in a user-facing answer fails. Regex, runs on every eval answer.
2. **Voice guards.** 5-6 pass/fail cases for already-ratified rules: no engagement-bait closers, decline voice shape (owner named, sources listed), account keys verbatim, no clock times in prose, no doc ids not from this turn's tools. Genuine disambiguation questions explicitly allowed (the R3-12 clarifier rule).
3. **Numeric stability across runs.** The harness already runs twice; add the rule that numeric answers must agree run-to-run. Divergence fails the case (the case-1a flake class).
4. **Permission-leak probe.** A standing case: operator-level session requests corporate-gated content; expected = the polite wall, zero content leakage. Runs every harness invocation, forever; hard-fails the round on any leak. Priority raised before Phase D access widening.

## Tier 3 - opportunity finders (lines in the weekly R-Chat digest, no new infra)
1. **Decline clustering.** Group declined questions by topic; output = the documentation demand list, ranked by ask count.
2. **Snapshot-age monitor.** Any data source whose loaded-date exceeds 30 days and appears in answers gets flagged with its age (the directory's May 27 load would have flagged in June).
3. **Leash and speed dials.** Budget-saturation rate (baseline 3.0%) and p95 answer time, tracked week over week so drift is visible before complaints.
4. **KNOWN-FLAKE eval dials (added 2026-08-01, PR B acceptance ruling; case 7 added 2026-08-02, post-merge sanity ruling).** Per-run pass rate for the harness's non-gating flake cases, tracked so drift is visible before it becomes a real regression. Baseline dials:
   - `case1_manager` (phantom_citation mechanism): rate of runs where the model names an unretrieved doc id on the Source line. Mitigated by sanctioned line 6 but not eliminated.
   - `case2` (exact-id sensitivity mechanism): rate of runs where exact-id snippet framing shifts the chosen quote/section between runs.
   - `case5_typo` (typo-sensitivity mechanism): rate of runs where garbled input produces a differently-shaped-but-still-correct answer that trips the expected-shape regex.
   - `case7_vendor_count` (phantom-table + derived-arithmetic mechanism): rate of runs where the model writes "the top N are listed above" or derives a total the payload doesn't contain. Sanctioned lines 7 + 8 are partial mitigations, not full eliminations; every instance is caught by Tier 1 receipt so the user-visible status downgrades correctly. **Escalation ladder retired 2026-08-04** - the runtime bouncer landed in calibration round 2 as the zero-tool citation backstop (see below). The case-7 mechanism (numeric derivation from rendered rows) is a related-but-distinct flake pattern; the backstop targets ONLY zero-tool answers, not numeric derivations from tool-returned rows. If case-7 flake rate stays visible, the next lever is a separate no-derivation prompt round.
   - All four are non-memory, non-shipGate. Ship-gate cases (M1, M2, M3) are explicitly ineligible for the KNOWN-FLAKE carve-out - a shipGate fail is a STOP for architecture ruling, not a dial entry.

## Zero-tool citation backstop (shipped 2026-08-04, calibration round 2)

The loop-level mechanical backstop for zero-tool citation-bearing answers. When a turn completes with zero successful tool calls AND the answer carries a citation-shaped claim (a `Source:` line), the agent loop rejects the answer once and retries with a system-side nudge: `You answered without calling any tool. Call the tool that has this information and answer from its result.` If the retry also completes with zero tools, the answer ships as **partial** with the new reason string `Answered without checking a source this turn.` (added to `partialReason` mapping in `SousSurface.js`).

Exemptions: declines (no citation to make), clarifying questions and conversational replies (no citation shape), and any answer without a Source line at all. The trigger is zero-tools **plus** a citation claim.

Blast-radius pre-shipping: 39/117 (33.3%) of the last 30 days of `sousai_questions` completed with zero successful tool calls but carried a citation-shaped claim - the target scope. Client-side surface: the reason chip below the PARTIAL pill; grader-visible via a new `zero_tool_no_check` flag on the done envelope so the R-Chat digest can count backstop firings vs. successful catches vs. residual escapes.

## Tier 4 - the grader audit (standing practice, quarterly, ~30 min of Kevin)
Pull 20 random production answers; Kevin hand-labels true status blind; compare to the grader's labels; investigate every disagreement. The referee gets a referee - the next 77.8%-class bug becomes a scheduled discovery instead of an accident. First run: one quarter after the calibration round merges. Kevin calendars it.

## Explicitly not doing
No synthetic charm metrics, no engagement/session-length tracking, no LLM-judges-LLM voice scoring (the voice guards are mechanical on purpose). Personality is protected by rules with teeth, not vibes with dashboards.

## Landing map
- PR B prompt: Tier 1 + Tier 2 as harness requirements; this doc committed to `docs/SOUS_TESTING_PLAN.md` in that PR.
- Next R-Chat digest update prompt: Tier 3 lines.
- Kevin's calendar: Tier 4, quarterly.
- Plan file: referenced from v2.70 when the PR B prompt is written.
