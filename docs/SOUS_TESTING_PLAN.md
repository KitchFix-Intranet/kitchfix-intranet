# Sous Testing Plan - ratified 2026-08-01

**Ratified by Kevin, same-day as the calibration round's 77.8% false-alarm finding.** Theme: check the answer, not just the plumbing. Each item names its mechanism and where it lands. This doc feeds the PR B prompt (harness sections), the next R-Chat digest update, and one standing calendar practice; it commits to `docs/` with whichever of those lands first.

## Tier 1 - the receipt check (gates PR B, non-negotiable)
**Every number has a receipt.** For every data answer in the eval set: extract each numeric figure from the answer text, assert it appears in that turn's tool payload rows. Catches hallucinated math, wrong-column reads, and - the reason it gates memory - numbers reused from conversation history instead of fresh tools. This is the parked re-query eval in its final form: the memory eval asks a follow-up numeric question and the receipt check proves the number came from the follow-up turn's own tool call. Closes the named Phase E gap (call-succeeded is not answer-follows).

**Fact-receipt extension (added 2026-08-04, calibration round 2).** The numeric extractor never sees names, doc ids, or account keys - exactly the class of fact the live 2026-08-03 sous-chef reproduction produced ("Adam Lacy" returned with a citation, zero tool calls, PARTIAL for the wrong reason). For eval cases flagged as fact-answers, the harness extracts named entities from the answer and asserts each appears in that turn's tool-payload text (a mechanical containment check against `JSON.stringify(rawResult)`, not an NLP extractor). Applied to the new M3 gate case (sous-chef fact lookup). Existing cases where the extension would flip a passing case are left alone and logged.

## Tier 2 - cheap guards (ride PR B's harness additions)
1. **No-plumbing check.** Maintain a list of internal identifiers (tool names, table/view names, env-var names). Any appearance in a user-facing answer fails. Regex, runs on every eval answer.
2. **Voice guards.** 5-6 pass/fail cases for already-ratified rules: no engagement-bait closers, decline voice shape (owner named, sources listed), account keys verbatim, no clock times in prose, no doc ids not from this turn's tools. Genuine disambiguation questions explicitly allowed (the R3-12 clarifier rule).
3. **Numeric stability across runs.** The harness already runs twice; add the rule that numeric answers must agree run-to-run. Divergence fails the case (the case-1a flake class). **Softened 2026-08-04 (pre-demo fixes):** when BOTH runs' Tier-1 receipts pass (every number in each answer traces to that run's own payload), skip Tier-2c. The "38 vs 42 vendors" contradiction case this check exists for is mechanically distinct - it fails Tier-1 receipt on the losing run. When both Tier-1 checks pass, Tier-2c was flagging legitimate supplementary-content variance, not a stability issue.
4. **Permission-leak probe.** A standing case: operator-level session requests corporate-gated content; expected = the polite wall, zero content leakage. Runs every harness invocation, forever; hard-fails the round on any leak. Priority raised before Phase D access widening.
5. **No leading opener (shipped 2026-08-04, pre-demo fixes P1 followup).** Assertion on every gating case's shipped answer: does not begin with an agreement opener (`you're right`, `apologies`, `sorry`, ...) or a self-narration opener (`let me pull`, `let me check`, `let me look`). Same regex families as `selfCheck.js`'s `AGREEMENT_OPENERS` + `SELF_NARRATION_OPENERS`. Guard proves the L12 self-check strips are reaching the client (the shipped answer, not the streamed text) and gives us a hard-fail signal if the client-side replace-on-done ever regresses.
6. **No existence-denial (Sous v2.0 close-out, sanctioned line 12).** Three new gating cases assert the model does not publish "this does not exist" as an answer when a tool returns nothing or no tool applies. `case_no_denial_tbr_mlb` (restored TBR-FL Major League live failure), `case_empty_result_honesty` (P1 out-of-season window at CIN-AZ), `case_no_applicable_tool` (STL-MO service-group revenue split with no tool that carries the dimension). The graders share a denial-pattern detector + case-specific routing / no-fabrication / status checks.

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

## Numeric receipt backstop (shipped 2026-08-04, calibration round 2 architecture ruling)

Promoted the Tier 1 receipt check from harness-only to runtime. When a turn completes with at least one successful data-tool call AND the answer contains numeric figures that don't trace to that turn's payload, the loop rejects and retries once with a nudge naming the offending figures: `These figures are not in the tool results: <list>. Answer using only the values the tools returned, and say what you cannot compute.` If the retry still misses, the answer ships as **partial** with the reason string `Some figures could not be verified against the data.` (added to `partialReason` mapping ahead of `grounded_without_sources` because it's more specific - the sources are fine, the figures are the drift).

Shared containment logic lives in `src/lib/sousai/receiptCheck.js` - the harness imports the same `checkReceipts()` it always used for Tier 1 grading, so runtime enforcement and test-time verdict never drift.

Exemptions per Kevin's ruling: figures the user supplied in their own question, ordinals and list positions (`top 25`, `1st, 2nd`, `#12`), dates (`2026-08-04`, `Feb 15`, `February 2026`, standalone `20XX` years), and numbers inside quoted document text (blockquote lines and `"..."` / `'...'` spans - same principle as the citation-surface rule for names).

Cost guard: containment checks only, one retry maximum, no extra model calls beyond the single retry itself. Grader-visible via a new `receipt_miss` flag on the done envelope whose payload is the list of missing figures - the digest can count classes of failure (single-miss vs table-fabrication).

Motivating case: M1's post-line-8-amendment run 2 fabrication - `spend_summary` for Sysco returned `{line_count: 2794, dollar_total: 252174.16}`; the model produced an 11-row category-breakdown table (Protein $98,297, Dry Goods $47,523, etc.) with a computed 19.9% share and a fabricated $1,269,807 portfolio total. Prompt-only mitigation had hit its ceiling. This backstop is where the mechanical guarantee lives.

**Token-level redaction (added 2026-08-04, follow-up architecture ruling).** When the numeric backstop retry ALSO ships with misses, `redactMissingFigures(text, misses)` mechanically replaces each offending numeric token in the answer with the marker `[unverified]` before ship. Length-preserving exemption masking (dates, ordinals, quoted content) ensures a number token inside an exempt span is never redacted. Result: `"representing [unverified]% of total portfolio spend"` - ugly, honest, and impossible to copy into a deck as fact. Status stays partial with the existing `receipt_miss` reason chip. Motivating case: post-first-backstop-round M1 run 2 - retry nudge told the model "these figures are not in tool results", model responded by shipping the same fabricated `1,269,807.30` AND adding a fabricated attribution ("that figure is in the tool payload under `totals.dollar_total`"). Redaction guarantees the shipped answer cannot carry the fabricated number even when the model insists it can.

**`normalizeNumeric` round-trip fix (added 2026-08-04, follow-up).** Root cause of the M1 drop: the checker false-flagged correctly-grounded numbers. Answer had `"$1,269,807.30"` which stripped to `"1269807.30"`; payload had the number as a JS `1269807.3` which stringified to `"1269807.3"`. String compare after decorator-strip left them unequal because of the trailing zero. Fix: parse-and-back via `Number()` so both sides normalize to `"1269807.3"`. Retro-applies to the harness Tier 1 grader (shared module) - identical containment behaviour runtime and test-time.

**Phone-format exemption (added 2026-08-04, round 0b Part 2).** A payload phone stored as bare digits (`"7042995170"`) checked against an answer that presents it hyphenated (`"704-299-5170"`) previously flagged three separate fabrications - the vanilla number regex broke the answer into `704`, `299`, `5170` tokens and none matched the payload. Live case: "call Bill at 704-299-5170" tripped the numeric-receipt retry and destroyed the answer with a three-sentence apology about a phone number's formatting. Fix in `receiptCheck.js`: `maskGroundedPhones(text, payloadNums)` scans the answer for phone-shaped clusters (`\d{3}[-.\s]\d{3}[-.\s]\d{4}` and `(\d{3}) \d{3}-\d{4}`), normalizes each to digits-only, and length-preservingly masks the ones that match a payload number. Fabricated phones stay unmasked so their digit-groups still flag - the receipt check IS the point. Runs BEFORE the vanilla `NUMBER_RE` extraction inside `checkReceipts`. Unit test fixture in `receiptCheck.test.js` covers the Bill Hofmann case verbatim plus fabricated-phone still-flags plus each punctuation variant.

## L12 final self-check pass (shipped 2026-08-04, round 0b Part 4)

A mechanical last pass before an answer ships. No additional model call. Lives in `src/lib/sousai/selfCheck.js`, called from `agent.js` after the runtime retries settle and after `redactMissingFigures` runs, before the return.

**Strip families:**
1. **Agreement openers** (from the retry-integrity spec, Part 1.2): `you're right`, `you are right`, `good catch`, `great question`, `apologies`, `sorry` - case-insensitive, first-sentence only. Prompted by the live 2026-08-04 retry-leakage case where the model was shipping "You're right. The tool returned $31,697.52 for Fresh Point ..." on a question that never mentioned Fresh Point.
2. **Self-narration openers**: `let me pull`, `let me check`, `let me look`.
3. **Internal-identifier leaks**: reuses the shared no-plumbing lists in `src/lib/sousai/internalIdentifiers.js` (moved out of the harness so runtime and test-time share one source of truth). Body hits get stripped mechanically. Source-line hits (tool names only - the ALWAYS list is never sanctioned) get REPLACED with the mapped human label (`SC tools` / `spend tools` / `leadership directory`) so the citation surface stays intact rather than losing a token.
4. **Clock times in prose**: `\d{1,2}:\d{2}(?::\d{2})?(?: am|pm)? UTC?` shape. Freshness is `PG live` plus a date only per sanctioned line 4.

**Multi-part completeness check (L7, Part 5).** Detects multi-part questions via `and <wh>` conjunction OR ≥2 question marks OR two-clause splits with wh-anchors. For each detected sub-question runs term-overlap (content words from the sub-question appear in the answer) plus a `who`-specific augment (role markers `RDO`/`EC`/`chef` etc., contact verbs `call`/`contact`/`reach`, capitalized proper-noun shapes). Any sub-question with no evidence surfaces as `unaddressedParts`; the agent loop adds an `incomplete_multipart: [<parts>]` flag and downgrades grounded → partial. New reason-chip string `Part of your question could not be answered.` in `SousSurface.js` `partialReason()` mapping.

**Fence (Kevin's spec):** the self-check may ONLY remove or flag. Must NEVER rewrite content. Must NEVER strip inside quoted document text - blockquote lines (leading `>`) and inline `"..."` / `'...'` spans are position-masked by `isInsideQuoted()` before any strip touches them.

**Per-family strip counters** bubble into a `self-check-strip` trajectory event so the digest can count firings across production traffic (Tier 3).

**Grader-visible via `incomplete_multipart` flag** on the done envelope. Harness case `case_multipart_completeness` asserts "which accounts are behind on February entry, and who should I contact about each?" either addresses both parts in the body OR surfaces with the flag; failure mode is a grounded answer that silently drops one part.

## Tier 4 - the grader audit (standing practice, quarterly, ~30 min of Kevin)
Pull 20 random production answers; Kevin hand-labels true status blind; compare to the grader's labels; investigate every disagreement. The referee gets a referee - the next 77.8%-class bug becomes a scheduled discovery instead of an accident. First run: one quarter after the calibration round merges. Kevin calendars it.

## Explicitly not doing
No synthetic charm metrics, no engagement/session-length tracking, no LLM-judges-LLM voice scoring (the voice guards are mechanical on purpose). Personality is protected by rules with teeth, not vibes with dashboards.

## Landing map
- PR B prompt: Tier 1 + Tier 2 as harness requirements; this doc committed to `docs/SOUS_TESTING_PLAN.md` in that PR.
- Next R-Chat digest update prompt: Tier 3 lines.
- Kevin's calendar: Tier 4, quarterly.
- Plan file: referenced from v2.70 when the PR B prompt is written.
