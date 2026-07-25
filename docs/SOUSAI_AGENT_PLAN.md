# SousAI Agent Plan - Scope + Implementation Plan

**Status:** RATIFIED by Kevin, 2026-07-25 (Decision 1 closed). Living document.
**Version:** v1.7
**Repo home:** `docs/SOUSAI_AGENT_PLAN.md` - committed by CC in each phase PR. The repo copy is canonical; `docs/PROJECT_DASHBOARD.md` points here for the SousAI workstream.

---

## How this document works

- Chat-Claude authors every revision. CC never edits this file on its own judgment; each phase's CC prompt includes the updated file (or a patch) to commit with that phase's PR.
- Kevin merges nothing whose plan section does not match what actually shipped. A mismatch is a bounce, same as any Build Accuracy Protocol failure.
- The Status board, Decision register, PR ledger, and Changelog below are the alignment surface. If a section and reality disagree, the repo and PG are canonical and this doc gets corrected in the next revision, flagged as doc-drift.
- Roles, standing: Kevin decides and merges. Chat drives - specs, prompts, this plan, design review. CC builds - code, git, PG, reports with [ran]/[code-read] labels.

## You are here (updated every revision)

- **Now:** Phase B1. #528 merged - Phase A DONE, tools live on main. B1 CC prompt delivered: agent loop + prompt port + rule-7 spec amendment + the spike gate (branch `feat/sousai-agent-b1`; this plan v1.7 rides in, replacing v1.4). Data-surface discovery still parallel.
- **Next:** CC reports the spike record; Chat grades; if the gate passes, Kevin merges and Chat issues B2 (route + streaming + flag). If the gate fails after one prompt-adjustment round, we stop and reassess - that is the kill switch working.
- **Open decisions:** only Decision 5 (v1 data-tool pick), on the discovery report. Case 8 of the spike produces the evidence for the parked PB-001 TOKEN_CAP call.

## Status board

| Phase | What | Gate | Status | PR |
|---|---|---|---|---|
| 0 | Close the CK-8 record (#525 corrections) | Kevin merges #525 | **DONE 2026-07-25** | #525 merged |
| A | Tool layer + CLI probe | Probe passes all tiers incl. must-fail cases | **DONE 2026-07-25** | #528 merged |
| B1 | Agent loop as lib + CLI harness | **Spike gate: 7 pre-written cases run twice + latency. Kill switch.** | IN FLIGHT - CC prompt delivered | PR pending |
| B2 | `/api/sousai` route, streaming, flag, admin-only | Route serves B1 behavior end to end | Not started | - |
| C | Trajectory logging (migration + wiring) | Log rows visible in Supabase dashboard from first admin question | Not started | - |
| D | Surface (UI): page first, then global corner-overlay launcher | Kevin approves renders, then build passes design review | Decision closed - awaits B2 | - |
| E | Eval set + runner | 40-60 questions, runner green per Decision 7 bar (90/100) | Draftable now; complete before G | - |
| F | Data tools | Per-domain PRs, eval questions ride along | Decision 2 closed; awaiting Decision 5 discovery review | - |
| G | Launch to operators | Eval green every run, zero-tolerance clean, logging live | Blocked on all above | - |

## Decision register

| # | Decision | Gates | Status | Notes / recommendation |
|---|---|---|---|---|
| 1 | Ratify this scope | Everything | **CLOSED 2026-07-25** | Ratified as written plus Supabase addenda. |
| 2 | Data-access policy | Phase F | **CLOSED 2026-07-25** | All operators may query all accounts' operational data. Carve-out: People Portal PAF wage and reimbursement data is SLT-or-own-records only, and is excluded from the v1 tool surface entirely (enforced by absence; identity-scoped enforcement gets specced if those tools are ever built). Deliberate asymmetry recorded: REC document tiers unchanged - the ruling covers data via tools, not document access. |
| 3 | Surface | Phase D | **CLOSED 2026-07-25** | v1 = dedicated page. Full rollout target = persistent chat icon opening a corner-overlay helper on all pages (D2 follow-on). Doc-context entry can fold into the overlay later. Renders precede both builds. |
| 4 | Agent status visibility | Phase A default | **CLOSED 2026-07-25** | Finished (Live) docs only for the agent. Current RPC behavior preserved for non-agent callers. |
| 5 | Data-half v1 scope | Phase F size | **IN DISCOVERY** | CC data-surface report commissioned 2026-07-25; Kevin + Chat pick the v1 tool set from it. Wishlist recorded: directory, inventory, periods/homestands, all SC projections + actuals, period financial data (in-build - wire only what exists), invoices, vendors. |
| 6 | Anthropic SDK vs raw fetch | Phase B1 | **CLOSED 2026-07-25** | Official Anthropic SDK, confirmed by Kevin. Vendor client library, not new tooling - the agent loop uses exactly the streaming + tool-block features where hand-rolling breeds bugs. |
| 7 | Eval pass bar | Phase G | **CLOSED 2026-07-25** | Confirmed by Kevin: 90 percent aggregate on every run, 100 percent on the zero-tolerance subset. Plus a runtime answer-status badge (Grounded / Partial / Declined) on every answer - see §6 item 9. Numeric confidence scores explicitly rejected as false precision. |

## PR ledger

| PR | Phase | Title | State |
|---|---|---|---|
| #525 | 0 | docs(sousai): retrieval regression at current corpus scale (CK-8) | **MERGED 2026-07-25** |
| TBD | F-prep | docs(sousai): PG data-surface discovery (Decision 5 input) | CC prompt delivered 2026-07-25; read-only, own branch |
| #528 | A | feat(sousai): phase A tool layer + probe | **MERGED 2026-07-25** - carried plan v1.4 into the repo |
| TBD | B1 | feat(sousai): phase B1 agent loop + spike | CC prompt delivered 2026-07-25; carries plan v1.7, rule-7 spec amendment rides along |

## Parked maintenance queue (small standalone PRs, Kevin schedules)

1. **Character Spec §8 rule-7 amendment.** The template-as-canonical rule is enforced in the demo-branch prompt and missing from the spec. Small docs PR; should land before or alongside B1's prompt port so the spec and the shipped prompt agree.
2. **Chunk language mislabel.** All chunks are stamped `language='en'` regardless of content - POL-006-ES (15 chunks) and POST-001-ES (1 chunk) carry Spanish text under en labels [ran, #528 verification]. Zero impact today; fix (derive language at embed time from frontmatter or the -ES suffix, re-embed 16 chunks) must land before any feature reads the language column as truth.

---

## 1. Why this architecture (the evidence)

From the 2026-07-25 CK-8 regression:

- Retrieval is strong: 10 of 10, correct docs on top, zero access leakage in the measured scope.
- No absolute similarity floor can work: the documented typo path's best real hit (0.347) scores below the no-answer ceiling (0.502). The classes overlap; recalibration is eliminated by data.
- Absolute scores rescale when the ingestion pipeline changes - confirmed by commit archaeology on #525: the June baseline ran on Drive-extracted chunks; A5 (`001a8eb`, 2026-06-16) swapped in MDX extraction with Fact resolution and NonCanonical stripping, and the distribution moved ~2x. Contextual headers were day-one and not a factor; the RPC scoring math never changed. Any future pipeline change (chunker rewrite, Fact-registry expansion, Include policy) rescales again, so any absolute floor breaks on the next change.

The agent replaces the dead floor with the model judging whether retrieved material answers the question, and it is the only architecture on the table that also answers the data-question class.

## 2. The end state

An operator asks Sous a question in plain English and gets one of three outcomes:

1. A document answer: one to three sentences, then doc-id and section citations linking into the reader. Built from full documents, not snippets.
2. A data answer: the number, with provenance ("from daily actuals, P5 2026, as of this morning"), from a fixed parameterised query. Never from a document.
3. An honest decline in Sous's voice when neither corpus nor tools can answer.

Mixed questions return both halves, clearly labeled as contract terms versus actuals.

Launch bar: the eval set at the Decision 7 pass rate, zero tolerance for confidently-wrong answers on money or safety questions, both question classes handled.

## 3. What stays untouched

- The corpus: 128 MDX docs, STD-004 governance, tiers, verbatim contract preservation, validators, projection engine.
- L1-L3: `document_chunks`, pgvector + HNSW, extractMdx.js (NonCanonical strip at line 114), chunk.js contextual headers, Fact/Include resolution, embed.js, store.js, the `match_document_chunks` RPC with access-level and Retired filters.
- The access model: three hierarchical tiers, membership resolved app-side via opdAcl.js, enforcement inside the query.
- The embed workflow: CLI plus the corpus GitHub Action. L4 auto-trigger stays deferred.
- The Character Spec and hard floor. The §8 rule-7 amendment remains its own small PR.
- Bilingual position: Sous answers in English; Spanish source docs remain retrievable.
- POST-class stub handling: `SKIP_TEXT_EXTRACTION_CLASSES` and `embedPosterStub` remain the pattern.

## 4. What is deleted or demoted from the prior plan

| Item | Old plan | New status | Why |
|---|---|---|---|
| 0.28 similarity floor | Decline gatekeeper | Deleted as a gate; raw scores still logged | Proven non-separable at CK-8 |
| Threshold recalibration | Checklist item | Deleted | No absolute floor passes typos and blocks misses |
| Reranker | Checklist item | Deleted | Protected a blind single-shot; the agent reads and iterates |
| Hybrid search | Critical path | Optional tune-up of the search tool | getDocument by ID + listDocuments close most of the exact-match hole |
| Doc-vs-data router | Implied build | Never needed | Native tool choice is the router |
| Demo pipeline port | Gated on regression | Port the prompt, not the pipeline | See §8 |

Two demo-era binding constants are overridden with the regression as evidence: the 0.28 floor and the Haiku model choice. Everything else in the binding-decisions register (onboarding readme §37.5) is honored.

## 5. The build, phase by phase

One axis per PR. Outcome-level acceptance gates. Dependency order.

### Phase 0 - close the record (in flight)

PR #525 corrections land (causal paragraph rewritten to evidence, manager-scope REC run added). Kevin merges. Nothing below starts before this merges.

### Phase A - the tool layer (PR A)

Plain server functions in `src/lib/sousai/tools/`, each callable and testable with no agent, no route, no UI. All PG access via the existing supabase-js service-role client (PostgREST over HTTP - no connection-pool risk under Vercel serverless, which matters when one question triggers several DB calls).

1. `searchDocuments(query, {accessLevels, k})` - embeds the query, calls the existing RPC, aggregates chunk hits to the document level: top docs ranked by best chunk score, each with matching snippets and scores. **The retrieval unit the agent sees is the document.**
2. `getDocument(docId, {accessLevels})` - full SousAI-safe text of one document, reconstructed by concatenating stored chunks in `chunk_index` order. Reuses the exact projection the chunker produced: NonCanonical stripped, Facts resolved, Includes expanded. No new extraction path, PG-only. Size guard: past a configured token cap, return sectioned with a truncation note.
3. `listDocuments({docClass, status, accessLevels})` - catalog from `documents`: id, title, class, status, access level. Makes enumeration questions ("which accounts are flat-fee") answerable by listing then reading.
4. Access enforcement inside every function: each takes the caller's resolved tier and filters identically to the RPC (archived excluded, Retired excluded, tier hierarchy honored). getDocument and listDocuments must replicate the RPC's filters or restricted content leaks through the side door. Status default per Decision 4: Live-only for agent-facing calls.
5. CLI probe `scripts/sousai-tools-test.mjs` exercising each tool at each tier, including must-fail cases (unrestricted caller requesting a restricted doc).
6. Folded-in measurement: corpus token totals from `token_count` (per doc and total), converting this plan's context math from estimate to number.

Gate A: probe passes at every tier with must-fail cases failing, [ran] evidence per Build Accuracy Protocol.

**Phase A results (2026-07-25, PR #528):** probe 10 of 10 [ran]. Measured corpus: 248,200 tokens across 112 chunked docs (smaller than the planning estimate of 400-700k); average chunk ~172 tokens; largest doc PB-001 at 19,815. Doc-unit retrieval is cheaper than planned. Endorsed deviation: getDocument gates access before status, so a refusal cannot leak a restricted doc's status - better information hygiene than specced, surfaced by CC in the PR body. Parked for B1: PB-001 exceeds TOKEN_CAP (12,000) with no section-fetch path; the spike decides cap-raise vs a section parameter. Noted for the agent prompt: a billing-rate probe query top-hit a template (TPL-020) - live confirmation that rule 7 (template-as-canonical is invention) must survive into the loop.

### Phase B - the agent loop and route (PR B1, PR B2)

PR B1 - the loop as a library plus CLI, no HTTP:

- `src/lib/sousai/agent.js`: sends Claude the system prompt, tool definitions, and question; executes requested tool calls server-side; loops to final answer; enforces a tool-budget cap of 8. The model-facing `get_document` accepts up to 6 doc ids per call (fanning out to the Phase A function unchanged) so enumeration questions fit the budget - this and the 6-to-8 budget raise are recorded B1 design deltas. Returns `{ answer, status, declined, decline_reason, sources, trajectory, usage }`. Status is the tri-state of §6 item 9, produced by a `[[STATUS: ...]]` footer the model emits and the loop parses and strips, with mechanical downgrade-only checks (phantom citations drop to partial; grounded with zero sources drops to partial).
- System prompt ported from `feat/sousai-demo:generate.js` (all 7 hard-floor rules, decline voice, citation discipline, banned openers), adapted for tool use: when to search vs open vs list, answer only from tool results, data-answer provenance format. A re-tune, not a rewrite - every change diffed against the 344-line base.
- Model: Sonnet-class. Prompt caching on system prompt + tool definitions.
- Fast path: simple lookups resolve in one search-then-answer round trip; the budget cap bounds the slow path.
- CLI harness `scripts/sousai-agent-test.mjs` seeded with the spike set.

PR B2 - the route:

- `/api/sousai` per the action-dispatch convention (actions: `ask`, `feedback`). Session resolves the caller's tier via opdAcl.js; the tier is injected into every tool call server-side. Streaming. Feature-flagged, admin-only at first.

**Gate B - the spike gate, the kill switch for the whole direction.** B1's CLI runs a pre-written set with pass/fail authored before the run, grounded in PG ground-truth checks. Every case runs twice - agents are stochastic, and a case passes only if both runs pass. Case 1 (synthesis) also reruns at operator scope with a no-leak criterion. A case 8 (informational, non-gating) probes a fact past PB-001's truncation point to produce the evidence for the parked TOKEN_CAP-vs-section-fetch decision.

1. Synthesis ("which accounts are flat-fee") - correct enumeration from the full REC set, no partial view.
2. Exact-ID ("show me FORM-003") - resolves via getDocument without a search detour.
3. Data-shaped question with no data tools wired ("P5 meal counts for CIN-AZ") - clean decline stating why; never answered from a document.
4. Out-of-corpus (Q8, "labor budget formula") - declines. The question the dead threshold would now answer wrongly.
5. Typo and Spanish paths (Q5, Q7) - still land the right doc.
6. Safety ("allergic reaction") - cites PB-002 and SOP-002 together.
7. Latency per question: streaming start and total.

Fail after one round of prompt adjustment: stop and reassess before any UI or data work exists.

### Phase C - trajectory logging (PR C)

- Migration (pr-7 series): `sousai_questions` - question, user, resolved tier, full tool trajectory (JSONB), answer, sources, declined flag, latency, model, token usage, thumbs feedback, timestamp.
- Wired into the route from the first admin-visible day. Immediately observable in the Supabase dashboard - real day-one visibility with zero admin-UI build.

### Phase D - the surface (PR D, then D2)

Decision 3 closed: v1 is a dedicated page; the full-rollout target is a persistent chat icon opening a corner-overlay helper on every page (D2, its own later PR sharing the same route and components). Renders and mockups precede each build. Includes: question box, streamed answer, the answer-status badge (§6 item 9), source chips linking into the reader, provenance line on data answers, thumbs feedback wired to the log. Design review per DESIGN_REVIEW_PERSONA before merge.

### Phase E - the eval set (PR E)

The launch instrument. 40-60 questions with known-correct answers and expected sources:

- Both classes, weighted toward what operators actually ask. Kevin sources and approves; Chat drafts candidates from the corpus and Kevin's examples.
- Zero-tolerance subset: every money and safety question. One failure blocks launch regardless of aggregate.
- Runner executes the agent end to end, grades source-match mechanically, grades answer correctness with an LLM judge plus human spot check, reports pass rate per class.
- Agent runs are stochastic: the runner executes the set multiple times per change; the bar applies to every run.

### Phase F - data tools (PR F1..Fn)

Decision 2 closed; Decision 5 gates scope via the data-surface discovery report. The genuinely new half.

- Access per Kevin's ruling: all operators may query all accounts' operational data. The People Portal PAF wage and reimbursement domain is excluded from the v1 tool surface entirely - the carve-out is enforced by absence. If those tools are ever built, they take the caller's identity and enforce own-records-or-SLT.
- Fixed parameterised functions only. Plain JS functions doing filtered selects against existing views (`sc_month_summary`, `v_count_session_totals`, `v_price_movers`) through the supabase client - not new PG RPCs unless a tool genuinely needs multi-statement logic. The model never writes SQL.
- The v1 tool set is picked by Kevin and Chat from the discovery report's candidate menu (Decision 5). In-flight sources (period financial data still being built) are not wired until they exist.
- Every data answer carries provenance: source view, parameters, as-of timestamp. No rows is "no rows," never zero. A failed query is a failure, never an empty result.
- Each domain batch is its own PR with its eval questions added in the same PR.

### Phase G - launch

Eval green across required runs, zero-tolerance subset clean, logging live, flag opened to operators on the chosen surface. v1.0.

## 6. Key technical decisions (fixed by this plan)

1. Retrieval unit is the document. Chunks locate; documents inform.
2. getDocument serves the chunk-reconstructed projection - the hard floor holds on the full-doc path with no second pipeline to keep honest.
3. Agent status visibility defaults to Live-only (Decision 4); current RPC behavior preserved for non-agent callers.
4. Decline is the model's judgment bounded by the hard-floor prompt. Similarity scores ride in the trajectory log; they gate nothing.
5. Tool budget and streaming are v1 requirements, for the phone-in-cooler user. Latency measured from the spike onward.
6. All DB access through supabase-js with service role, tiers enforced in tool code. **RLS is explicitly out of scope for v1** - it requires per-user Supabase JWTs and an auth-model overhaul (auth-adjacent, hidden 2-3x cost). Someday-hardening list.
7. **The Supabase MCP server is never wired to Sous** - it grants broad SQL execution, the exact model-writes-SQL pattern this plan bans. Fine for CC during development; never a Sous tool.
8. Anthropic SDK vs raw fetch is Decision 6 (closed: SDK).
9. **Answer-status badge, not numeric confidence.** Every answer carries a tri-state: Grounded (every claim cites a fetched source or carries data provenance), Partial (adjacent material found, question judged not fully answered), Declined (hard-floor outcome). Driven by a structured completeness field the agent emits (Phase B) plus mechanical checks (every claim cited; no tool failures), displayed as a badge (Phase D). Numeric confidence percentages are rejected - models produce uncalibrated numbers, and fake precision manufactures trust on exactly the answers that least deserve it. Raw retrieval scores stay in the trajectory log, never operator-facing.

## 7. feat/sousai-demo disposition

Port the artifact, retire the branch. The SYSTEM_PROMPT (with rule 7 and tuned decline voice) is extracted into the new prompt module with a header crediting its two tuning rounds; the 7 generation-test questions move into the eval set; route and UI files are reference only. After PR B1 lands, the branch is archived. The modal-variant question dies with it - Decision 3 replaces it.

## 8. Risks, honestly

- **Latency.** Multi-round-trip is slower than single-shot. Mitigations: streaming, fast path, budget cap, spike measurement. If the spike shows unacceptable floor-user latency, fallback is a two-tier design (fast single-search default, agent escalation on demand) - scoped only if needed.
- **Nondeterminism.** Same question, different tool path. Mitigations: trajectory logging from day one, multi-run eval bar. The real cost of the architecture, paid consciously.
- **Wrong tool choice.** A data question answered from a doc is the worst failure. Mitigations: the NonCanonical strip means the corpus structurally lacks plausible live figures; the prompt names the boundary; spike case 3 and eval test it directly; data tools eventually remove the temptation.
- **Prompt drift under re-tune.** Single-shot to tool-loop shifts behavior. Mitigation: diff every change against the 344-line base; eval as the regression net.
- **Cost.** Sonnet loop with cached prompt lands in the cents-per-question range. Logistics, not a decision factor, per Kevin. The log's usage column makes actuals visible day one.
- **Solo-maintainer surface.** More moving parts than a pipeline. Mitigation: tools are plain functions with CLI probes; the loop is one file; nothing adds infrastructure beyond one table and one route.

## Changelog

- **v1.7 - 2026-07-25.** #528 merged; Phase A closed. B1 CC prompt issued. Recorded B1 design deltas: tool budget 6 to 8 with batched get_document (max 6 ids per call) so enumeration fits; status produced via a parsed `[[STATUS]]` footer with downgrade-only mechanical checks; spike cases run twice each with both-runs-pass required; case 1 gains an operator-scope no-leak rerun; case 8 added (informational PB-001 depth probe feeding the TOKEN_CAP decision). Rule-7 spec amendment folded into the B1 PR as the sanctioned spec-with-prompt exception to one-axis.
- **v1.6 - 2026-07-25.** #528 language verification clean: all 1,445 chunks labeled en [ran], branch A (no code change), PR merge-ready. CC's original "no ES chunks" claim proven wrong-but-safe: POL-006-ES and POST-001-ES have chunks mislabeled en - filed as parked maintenance item 2 alongside the rule-7 spec amendment in a new Parked maintenance queue section.
- **v1.5 - 2026-07-25.** PR #528 delivered and graded: 10/10 probe, plan v1.4 landed in repo. Recorded measured corpus (248,200 tokens; avg chunk ~172; PB-001 largest at 19,815), endorsed CC's access-before-status gate order, parked the PB-001 TOKEN_CAP question for the B1 spike, noted the TPL-020 rule-7 confirmation. One pre-merge verification in flight: [ran] evidence for the language="en" hardcode (silent-empty risk if non-en Live chunks exist).
- **v1.4 - 2026-07-25.** Kevin confirmed Decisions 6 (SDK) and 7 (90/100 bar + tri-state badge). Register wording finalized; no scope change.
- **v1.3 - 2026-07-25.** #525 merged; Phase 0 closed. Phase A CC prompt issued: three tools (searchDocuments doc-level aggregation, getDocument chunk-reconstruction with typed refusals and token cap, listDocuments) plus the 11-case CLI probe with must-fail access cases and the corpus token-totals measurement. This plan file enters the repo in PR A. Status board, ledger, You-are-here updated.
- **v1.2 - 2026-07-25.** Kevin ruled: Decision 2 closed (open data access; PAF wage/reimbursement carve-out SLT-or-own-records, excluded from v1 surface); Decision 3 closed (page first, corner-overlay launcher as D2); Decision 4 closed (Live-only); Decision 6 closed (SDK); Decision 7 closed (90/100 bar plus tri-state answer badge, numeric confidence rejected - new §6 item 9). Decision 5 converted to discovery: CC data-surface report commissioned, ledger row added. Phases D and F rewritten to match rulings.
- **v1.1 - 2026-07-25.** PR #525 amendment landed (`15663db`) and graded complete by Chat. §1 evidence updated from "pending confirmation" to confirmed: A5 pipeline swap drove the score rescale; headers day-one; RPC math unchanged. Manager-scope REC run recorded as a measured zero with the directed-account-question caveat carried into the spike and eval scope. Status board, You-are-here, and PR ledger updated. Awaiting Kevin's merge to close Phase 0.
- **v1.0 - 2026-07-25.** Ratified by Kevin. Converted from scope draft to living scope + implementation plan: added How-this-works, You-are-here, Status board, Decision register, PR ledger, Changelog. Folded in Supabase addenda: PostgREST/no-pool rationale, plain-JS data tools over views (no new RPCs by default), RLS out of scope for v1, Supabase MCP never wired to Sous, dashboard observability on the question log. Renamed from SOUSAI_AGENT_MIGRATION_SCOPE to SOUSAI_AGENT_PLAN for repo life.
