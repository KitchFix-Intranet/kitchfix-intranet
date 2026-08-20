// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/agent.js
// SousAI · Phase B1 · agent loop (system prompt + 3 tools + streaming final)
// ─────────────────────────────────────────────────────────────────────────────
//
// The agent loop for SousAI. Wraps the Phase A tools (search_documents,
// get_document, list_documents) behind the Anthropic tool-use API and runs a
// bounded tool-use loop until the model stops requesting tools or the budget
// is exhausted. The final turn streams so time-to-first-token is observable.
//
// Access model:
//   accessLevels is a caller-supplied array (pre-resolved via opdAcl). It is
//   NEVER exposed to the model - not in tool definitions, not in tool inputs,
//   not in tool results. Every tool execution injects the caller's accessLevels
//   server-side. If the model somehow requested an accessLevels parameter, it
//   would be ignored.
//
// Status contract:
//   The model ends its answer with a [[STATUS: grounded|partial|declined]]
//   line, and when declined a preceding [[REASON: <short>]]. The loop parses
//   both, strips them from the answer text, and returns them as fields.
//   Mechanical checks can only DOWNGRADE (grounded -> partial), never upgrade.
//
// Return:
//   { answer, status, declined, decline_reason, sources, trajectory, usage }
//
// Errors:
//   - A tool that throws becomes a tool-error result the model sees and can
//     react to (recorded in the trajectory with flag `tool_error: true`).
//   - The loop itself throws only on SDK / auth failure.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { SOUSAI_SYSTEM_PROMPT } from "./agentPrompt.js";
import { getToolDefinitions, getTool } from "./tools/registry.js";
import { checkReceipts, hasSuccessfulDataCall, redactMissingFigures } from "./receiptCheck.js";
import { applySelfCheck } from "./selfCheck.js";
import { CLAUDE_SONNET_MODEL } from "../anthropicModel.js";

// ── Tunables ─────────────────────────────────────────────────────────────────
// Aliased so the route + agent keep their existing named import while
// the model string tracks the shared source. Redefine only if Sous
// deliberately diverges from the shared Sonnet.
export const SOUSAI_AGENT_MODEL = CLAUDE_SONNET_MODEL;
// R3-05 rider (Kevin ruling): raised from 8 to 14 to comfortably cover a
// full account fan-out (an 11-account "breakfast per account" ask hit the
// old 8 budget after 6 tool calls, leaving 5 accounts unanswered). This is
// a stopgap - the real fix is a batch tool (Phase F candidate: wire
// `sc_month_summary` as an all-accounts one-call tool). No loop
// restructure, no parallelism; just the one constant.
export const TOOL_BUDGET = 14;
// Pre-demo Fix 1 (2026-08-04, P0): raised from 1024 to 2048 after live
// production found "what is our allergen procedure?" shipping PARTIAL /
// "Answer was cut short" mid-word ("Pull the suspected item and all
// utens..."). The model reached the 1024 output ceiling before finishing
// PB-002's protocol steps + Source line + section refs; total_ms 33.2s.
// Same question was GROUNDED at 22.7s pre-#622. Ceiling was the binding
// constraint. 2048 gives comfortable headroom for any long Playbook
// procedure without paying for tokens the model never emits (typical
// answer runs 200-600 output tokens). Single knob to raise for future
// answer classes that grow past this.
export const MAX_OUTPUT_TOKENS = 2048;

// ── Tool dispatch ────────────────────────────────────────────────────────────
// Every tool ships through the registry. Adding a data tool is one file plus
// one registry entry - agent.js does not diff.

async function executeTool(name, input, accessLevels) {
  const tool = getTool(name);
  if (!tool) return { error: `unknown tool: ${name}` };
  return tool.execute(input, { accessLevels });
}

// ── Answer parsing ───────────────────────────────────────────────────────────
// Match [[STATUS: grounded]] etc anywhere in the last chunk of the message.
const STATUS_RE = /\[\[STATUS:\s*(grounded|partial|declined)\]\]/i;
const REASON_RE = /\[\[REASON:\s*([^\]]+?)\]\]/i;
// Doc-id citation shape: PB-002, SOP-002, FORM-003, POL-006, STD-004, etc.
// Word-boundary bracketed to avoid grabbing partial matches inside other tokens.
const CITATION_RE = /\b([A-Z]{2,6})-([0-9]{3})\b/g;
// A citation-surface line - "Source: ...", "**Source:** ...", optionally
// bulleted. R3-05(b) grader refinement (Kevin ruling): phantom_citation
// evaluates ids on the citation surface ONLY; doc ids inside quoted
// document content are content, not citations. A FORM template that
// references POL-XXX in its body no longer triggers phantom_citation just
// because the model quotes the template verbatim.
const SOURCE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?source(?:s)?(?:\*\*)?\s*:/i;

// 2026-08-04 (calibration round 2): does the raw answer carry ANY Source
// line? Used by the zero-tool backstop below to distinguish citation-
// bearing answers (which must be grounded in this turn's tools) from
// decline / clarifier / conversational replies that carry no citation
// claim at all. Iterates lines to avoid a global-regex `m`-flag rewrite
// of SOURCE_LINE_RE, which is also used single-line inside parseAnswer.
function hasSourceLine(rawText) {
  if (!rawText) return false;
  return rawText.split("\n").some((line) => SOURCE_LINE_RE.test(line));
}

function parseAnswer(rawText) {
  const statusMatch = rawText.match(STATUS_RE);
  const reasonMatch = rawText.match(REASON_RE);
  const status = statusMatch ? statusMatch[1].toLowerCase() : null;
  const decline_reason = reasonMatch ? reasonMatch[1].trim() : null;
  const cleaned = rawText
    .replace(STATUS_RE, "")
    .replace(REASON_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Only pull doc ids that appear on a Source line. IDs anywhere else in the
  // answer body are treated as prose/content, not citations.
  const cited = new Set();
  for (const line of cleaned.split("\n")) {
    if (SOURCE_LINE_RE.test(line)) {
      for (const m of line.matchAll(CITATION_RE)) cited.add(`${m[1]}-${m[2]}`);
    }
  }
  return { cleaned, status, decline_reason, cited: [...cited] };
}

// ── Trajectory helpers ───────────────────────────────────────────────────────
// Each tool owns its own summarize + collectIds via the registry. Data tools
// return [] from collectIds (their results are not doc-citations); document
// tools return the doc ids they retrieved.

function summarizeToolResult(name, result) {
  const tool = getTool(name);
  if (!tool) return { raw: result };
  return tool.summarize(result);
}

function collectRetrievedIds(trajectory) {
  const ids = new Set();
  for (const step of trajectory) {
    if (!step.tool) continue;
    const tool = getTool(step.tool);
    if (!tool) continue;
    for (const id of tool.collectIds(step.rawResult)) ids.add(id);
  }
  return ids;
}

// ── The agent loop ───────────────────────────────────────────────────────────

// Memory cap: prior-turn answer text truncated for context assembly.
// Questions never truncate (question text is short and load-bearing for
// meaning resolution); answers can be long, cap at 2000 chars with a
// visible marker so the model knows the truncation happened. Spec §8.2
// memory corollary: history tells you what the question means; tools
// tell you what the answer is - so cropping the answer for context
// signals meaning-only intent.
const MEMORY_ANSWER_CAP = 2000;
const MEMORY_TRUNCATION_MARKER = "\n\n[... answer truncated for context ...]";

function truncateForContext(text) {
  if (typeof text !== "string" || text.length <= MEMORY_ANSWER_CAP) return text || "";
  return text.slice(0, MEMORY_ANSWER_CAP) + MEMORY_TRUNCATION_MARKER;
}

/**
 * @param {object} opts
 * @param {string} opts.question
 * @param {string[]} opts.accessLevels
 * @param {Array<{question: string, answer: string}>} [opts.priorTurns] - last
 *   up-to-3 Q&A pairs from the current session, prepended as alternating
 *   user/assistant turns before the current question. Q&A text only; no
 *   trajectories, meta, or sources. Answers are capped at MEMORY_ANSWER_CAP.
 * @param {(event: {kind: string, ...}) => void} [opts.onEvent]
 * @returns {Promise<{
 *   answer: string,
 *   status: 'grounded'|'partial'|'declined',
 *   declined: boolean,
 *   decline_reason: string|null,
 *   sources: string[],
 *   trajectory: any[],
 *   usage: {input_tokens:number, output_tokens:number, cache_read_input_tokens:number, cache_creation_input_tokens:number}
 * }>}
 */
export async function runSousAgent({ question, accessLevels, priorTurns, onEvent }) {
  if (!question || typeof question !== "string") {
    throw new Error("runSousAgent: question is required (non-empty string)");
  }
  if (!Array.isArray(accessLevels)) {
    throw new Error("runSousAgent: accessLevels must be an array");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY_SOUS;
  if (!apiKey) {
    throw new Error("runSousAgent: ANTHROPIC_API_KEY_SOUS missing from environment");
  }
  const emit = typeof onEvent === "function" ? onEvent : () => {};

  const client = new Anthropic({ apiKey });

  // PR B memory: prepend prior turns as alternating user/assistant turns.
  // Client passes chronological order (oldest first). Truncate each answer
  // at MEMORY_ANSWER_CAP. Questions never truncate.
  const priorMessages = [];
  if (Array.isArray(priorTurns)) {
    for (const t of priorTurns) {
      if (!t || typeof t.question !== "string" || !t.question.trim()) continue;
      priorMessages.push({ role: "user", content: t.question });
      priorMessages.push({ role: "assistant", content: truncateForContext(t.answer) || "(no prior answer)" });
    }
  }
  const messages = [...priorMessages, { role: "user", content: question }];
  const trajectory = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  // Cached system prompt + tool defs (Anthropic ephemeral prompt caching,
  // ~5 min TTL). Two breakpoints total: one on the system prompt block, one
  // on the LAST tool definition - this tells the API to cache system prompt
  // + all tool definitions as a single prefix, reused across turns within
  // the TTL window and across retries within the same turn (retries re-invoke
  // messages.stream with identical system + tools, so the second call hits
  // cache). Round 0d Part B (N11): verified active; usage.cache_read_input_
  // tokens confirms cache hits on subsequent turns of the same session.
  const systemBlocks = [
    {
      type: "text",
      text: SOUSAI_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
  const TOOL_DEFS = getToolDefinitions();
  const cachedTools = TOOL_DEFS.map((t, i) =>
    i === TOOL_DEFS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
  );

  let toolsUsed = 0;
  let finalRawText = null;
  let finalStopReason = null;
  let firstTokenFired = false;
  // 2026-08-04 (calibration round 2 - Part 1): zero-tool citation backstop
  // state. When a turn completes with zero successful tool calls AND the
  // answer carries a citation-shaped claim (Source line, doc id, named
  // dataset), the loop rejects the answer once, appends a system-side
  // nudge, and gives the model one retry. If the retry also completes
  // with zero tools, ship the answer as partial with the accurate reason
  // string `Answered without checking a source this turn.` The prompt-
  // rule change alone (line 10, Part 2) is not enough - model behaviour
  // can still drift, so this is the mechanical backstop.
  let zeroToolRetryDone = false;
  let zeroToolBackstopFired = false;
  // 2026-08-04 (calibration round 2 architecture ruling - loop-level
  // numeric receipt backstop). After sanctioned line 8 was strengthened,
  // M1 still fabricated an 11-row category-breakdown table under variance.
  // Prompt-only mitigation has reached its ceiling; the harness's Tier 1
  // check is now promoted to a runtime check. When an answer completes
  // with at least one successful data-tool call AND numeric figures in
  // the answer don't trace to that turn's payload, the loop rejects and
  // retries once with a nudge naming the offending figures. If the retry
  // still misses, ship partial with reason "Some figures could not be
  // verified against the data." (see receipt_miss flag below).
  let numericRetryDone = false;
  let numericBackstopFired = false;
  let numericBackstopMisses = null;

  // Every turn streams. Text deltas emit as `text-delta` events on the fly;
  // the route layer forwards them as `token` events to the client. Tool-use
  // turns typically emit no text, but if the model does emit text-before-tool
  // ("let me look that up"), those deltas stream too - the client sees them
  // as part of the answer surface.
  //
  // stream.finalMessage() returns the same shape as messages.create's
  // response (content blocks + stop_reason + usage), so the loop math is
  // unchanged. This replaces the previous split behavior where intermediate
  // turns used messages.create and only the budget-exhausted terminal used
  // streaming - now terminal turns stream too, which is the whole point.
  // Inter-turn text separator. Fixes the run-together in Kevin's Phase F
  // spot-check ("Let me check:TBJ-FL breakfast rates"): text emitted before
  // a tool_use and text emitted after the tool result land back-to-back in
  // the client's answerText accumulator. Insert a "\n\n" once at the start
  // of any subsequent turn that emits its first text, if the prior turn
  // ended with text. Emitted BEFORE the first real chunk of the new turn
  // so the client's mdLite sees proper paragraph breaks.
  let priorTurnEndedWithText = false;
  let thisTurnEmittedText = false;

  async function streamedTurn() {
    thisTurnEmittedText = false;
    const stream = client.messages.stream({
      model: SOUSAI_AGENT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      tools: cachedTools,
      messages,
    });
    stream.on("text", (chunk) => {
      if (!firstTokenFired) {
        firstTokenFired = true;
        emit({ kind: "first-token", t: Date.now() });
      }
      if (!thisTurnEmittedText && priorTurnEndedWithText) {
        // First text delta of this turn AND the prior turn also emitted text -
        // separate them so the client's text accumulator doesn't concatenate
        // "Let me check:" + "TBJ-FL breakfast rates" without a break.
        emit({ kind: "text-delta", t: "\n\n" });
      }
      thisTurnEmittedText = true;
      emit({ kind: "text-delta", t: chunk });
    });
    const finalMsg = await stream.finalMessage();
    priorTurnEndedWithText = thisTurnEmittedText;
    return finalMsg;
  }

  while (true) {
    const budgetLeft = TOOL_BUDGET - toolsUsed;

    // If budget is exhausted, force a final no-tools turn.
    if (budgetLeft <= 0) {
      messages.push({
        role: "user",
        content:
          "Tool budget exhausted. Answer from what you have or decline honestly in the established voice. Do not request further tools.",
      });
      const finalResp = await streamedTurn();
      addUsage(usage, finalResp.usage);
      finalRawText = finalResp.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      finalStopReason = finalResp.stop_reason;
      trajectory.push({ tool: null, kind: "final", stop_reason: finalResp.stop_reason });
      break;
    }

    const resp = await streamedTurn();
    addUsage(usage, resp.usage);

    if (resp.stop_reason !== "tool_use") {
      // Model chose to answer. Assemble the full text from the streamed
      // content blocks for downstream checks ([[STATUS]] parse, citation
      // scan). The deltas already emitted live during the stream.
      finalRawText = resp.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      finalStopReason = resp.stop_reason;
      trajectory.push({ tool: null, kind: "final", stop_reason: resp.stop_reason });

      // 2026-08-04 (Part 1): zero-tool citation backstop. If this turn
      // ends with zero successful tool calls but the model wrote a
      // Source line, reject once and retry with a system nudge. Skips
      // declines (no citation to make), skips answers with no Source
      // line at all (clarifiers / conversational replies). Fires
      // exactly once per session per Kevin's spec.
      if (!zeroToolRetryDone && toolsUsed === 0) {
        const isDecline = /\[\[STATUS:\s*declined\]\]/i.test(finalRawText);
        if (!isDecline && hasSourceLine(finalRawText)) {
          zeroToolRetryDone = true;
          trajectory.push({
            tool: null,
            kind: "zero-tool-retry",
            reason: "answered with citation before calling any tool",
          });
          emit({ kind: "zero-tool-retry" });
          // Preserve the rejected attempt in the message log so the
          // model sees what it just said, then push the nudge as the
          // next user turn. The retry re-enters the tool-use loop
          // above with the model's fresh chance to call a tool.
          messages.push({ role: "assistant", content: finalRawText });
          messages.push({
            role: "user",
            content: "Re-answer the user's original question. Call the tool that carries the information and answer from its result. Do not mention this correction, do not reference the previous attempt, do not apologize.",
          });
          finalRawText = null;
          finalStopReason = null;
          continue;
        }
      }
      // Retry ALSO answered with zero tools. We ship this answer, but
      // grade it partial with the accurate reason string (see the
      // status downgrade block below).
      if (zeroToolRetryDone && toolsUsed === 0) {
        zeroToolBackstopFired = true;
      }

      // 2026-08-04 (architecture ruling): loop-level numeric receipt
      // backstop. Runs after the zero-tool branch so this only fires
      // for answers that DID call a data tool (declines and clarifier
      // answers are exempt because they don't carry receipts to check).
      // Uses the shared checkReceipts() from receiptCheck.js - same
      // containment logic the harness Tier 1 grades with. On miss,
      // reject once and retry with a nudge naming the offending figures.
      const isDecline = /\[\[STATUS:\s*declined\]\]/i.test(finalRawText);
      if (!isDecline && hasSuccessfulDataCall(trajectory, getTool)) {
        // Strip the STATUS sentinel before extraction so its digits don't
        // leak into answer numbers (parseAnswer runs post-loop; do the
        // strip inline here so the check sees only prose).
        const cleanedInLoop = finalRawText
          .replace(STATUS_RE, "")
          .replace(REASON_RE, "")
          .trim();
        const check = checkReceipts(cleanedInLoop, trajectory, { question });
        if (!check.pass) {
          if (!numericRetryDone) {
            numericRetryDone = true;
            trajectory.push({
              tool: null,
              kind: "numeric-receipt-retry",
              misses: check.missing,
            });
            emit({ kind: "zero-tool-retry" });   // client-side accumulator reset - same wire
            messages.push({ role: "assistant", content: finalRawText });
            messages.push({
              role: "user",
              content: `Re-answer the user's original question using only values from the tool results. Do not mention this correction, do not reference the previous attempt, do not repeat or discuss these figures: ${check.missing.join(", ")}. If a value the question asks for is not in the tool results, say what the results contain and name what is not available.`,
            });
            finalRawText = null;
            finalStopReason = null;
            continue;
          }
          // Retry ALSO missed - flag the backstop so the downgrade block
          // ships partial with the receipt_miss reason. The listed misses
          // land in the flag payload so the digest can count them.
          numericBackstopFired = true;
          numericBackstopMisses = check.missing;
        }
      }
      break;
    }

    // Tool use turn: execute every tool_use block, append tool_result content.
    const assistantContent = resp.content;
    messages.push({ role: "assistant", content: assistantContent });

    // Round 0d Part B (N3, 2026-08-04): execute all tool_use blocks in this
    // turn CONCURRENTLY. When the model returns multiple tool_use blocks in
    // one message, it has already decided to batch them - dependent chains
    // arrive across separate turns (the output of one turn's tool is used
    // in the NEXT turn's tool_use block). Tools within a single turn are
    // therefore independent and safe to run in parallel.
    //
    // Ordering guarantees preserved:
    //   - tool-start events emit synchronously in BLOCK ORDER before any
    //     execution begins, so the client's toolTrail list appears in the
    //     order the model requested.
    //   - trajectory entries + toolResults append in BLOCK ORDER after all
    //     promises resolve, so the trail reads coherently downstream.
    //   - tool-end events emit as each promise resolves (natural async
    //     ordering); the client-side matcher looks up by tool name, so a
    //     faster tool finishing first still updates the correct slot.
    const toolUseBlocks = assistantContent.filter((b) => b.type === "tool_use");
    const toolStartTimes = toolUseBlocks.map((block) => {
      const t0 = Date.now();
      emit({ kind: "tool-start", tool: block.name, input: sanitizeInputForEmit(block.input) });
      return t0;
    });
    // Reserve budget slots by block position so a later block that runs in
    // parallel with an earlier one doesn't double-spend the budget.
    const budgetSlots = toolUseBlocks.map((_, i) => toolsUsed + i);
    const executions = toolUseBlocks.map(async (block, i) => {
      const t0 = toolStartTimes[i];
      if (budgetSlots[i] >= TOOL_BUDGET) {
        emit({ kind: "tool-end", tool: block.name, ms: 0 });
        return { block, result: { error: "tool budget exhausted" }, toolError: true, ms: 0, budgetSkip: true };
      }
      let result;
      let toolError = false;
      try {
        result = await executeTool(block.name, block.input, accessLevels);
      } catch (e) {
        toolError = true;
        result = { error: e?.message || String(e) };
      }
      const t1 = Date.now();
      emit({ kind: "tool-end", tool: block.name, ms: t1 - t0 });
      return { block, result, toolError, ms: t1 - t0, budgetSkip: false };
    });
    const results = await Promise.all(executions);
    const toolResults = [];
    for (const r of results) {
      if (r.budgetSkip) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: r.block.id,
          content: JSON.stringify(r.result),
          is_error: true,
        });
        continue;
      }
      toolsUsed += 1;
      trajectory.push({
        tool: r.block.name,
        input: sanitizeInputForEmit(r.block.input),
        summary: summarizeToolResult(r.block.name, r.result),
        rawResult: r.result,
        tool_error: r.toolError,
        ms: r.ms,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: r.block.id,
        content: JSON.stringify(r.result),
        is_error: r.toolError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Parse and mechanically check the final answer.
  const { cleaned, status: rawStatus, decline_reason, cited } = parseAnswer(finalRawText || "");
  const retrievedIds = collectRetrievedIds(trajectory);
  const validSources = cited.filter((id) => retrievedIds.has(id));
  const phantomCitations = cited.filter((id) => !retrievedIds.has(id));

  // Data-tool grounding path: a successful data-tool call grounds the answer
  // even when the model cites the data source in prose ("Source: contacts,
  // loaded 2026-05-27") rather than a doc-id shape. Without this signal,
  // every data-tool answer downgrades to partial for lack of doc citations -
  // the trap Phase F PR 1 uncovered during re-cert.
  //
  // R3-05(a) live-review fix: this previously used a shape whitelist
  // (`r.total>0 || r.matches[] || r.accounts[] || r.team[]`) that missed
  // new tool return shapes as they landed - `spend_top_vendors` returns
  // `top_vendors[]` + `totals.total_vendors_canonical` and neither matched,
  // so "how many vendors do we have?" graded PARTIAL despite a successful
  // spend_top_vendors call. Broadened to any-successful-data-call; the
  // named-open gap (data signal is call-succeeded, not answer-follows-from-
  // rows) is a Phase E content-check requirement, out of scope here.
  const hadSuccessfulDataToolCall = trajectory.some((step) => {
    if (!step.tool) return false;
    const t = getTool(step.tool);
    if (!t || t.kind !== "data") return false;
    if (step.tool_error) return false;
    const r = step.rawResult;
    if (!r || r.error) return false;
    return true;
  });

  // Truncation handling. When the model hits max_tokens the stream ends
  // mid-answer with no [[STATUS]] footer and (usually) no closing citation
  // line, so parseAnswer returns rawStatus=null and cited=[]. The unfixed
  // status fallback would treat the fragment as a refusal - that is the
  // truncation-published-as-decline bug the 2026-07-30 re-sweep flagged on
  // Q4.6 (40-line comparison table cut off mid-word on "Source",
  // reported status=declined with empty sources).
  //
  // Rule (plan v2.62, mirroring the pagination "truncation must be visible"
  // rule one layer up): a cut-off answer is a PARTIAL answer, never a
  // decline. The answer text says so; the return carries a `truncated`
  // flag; a trajectory event makes it countable.
  const truncated = finalStopReason === "max_tokens";
  let cleanedWithNote = cleaned;
  if (truncated) {
    trajectory.push({ tool: null, kind: "truncation", stop_reason: "max_tokens" });
    emit({ kind: "truncation", stop_reason: "max_tokens" });
    const note = "\n\n_[Response was cut off at the output-token cap. What is above is a partial answer; ask again for the rest or narrow the question.]_";
    cleanedWithNote = cleaned + note;
  }

  let status;
  if (truncated) {
    // Never default to declined on truncation. Partial is honest - some
    // answer landed, more was intended. If the fragment happens to include
    // grounded citations, promote to grounded; otherwise stay partial.
    status = rawStatus === "grounded" && validSources.length > 0 && phantomCitations.length === 0
      ? "grounded"
      : "partial";
  } else {
    status = rawStatus || ((validSources.length === 0 && !hadSuccessfulDataToolCall) ? "declined" : "partial");
  }
  const flags = [];
  if (phantomCitations.length > 0) {
    flags.push({ phantom_citation: phantomCitations });
    if (status === "grounded") status = "partial";
  }
  if (status === "grounded" && validSources.length === 0 && !hadSuccessfulDataToolCall) {
    flags.push({ grounded_without_sources: true });
    status = "partial";
  }
  // 2026-08-04 (Part 1): zero-tool citation backstop flag. Fires when the
  // retry ALSO shipped without any tool call. Grader-visible so the
  // digest can count how often the backstop actually catches something
  // instead of being an unfalsifiable rule.
  if (zeroToolBackstopFired && status !== "declined") {
    flags.push({ zero_tool_no_check: true });
    if (status === "grounded") status = "partial";
  }
  // 2026-08-04 (architecture ruling): numeric receipt backstop flag.
  // Fires when the retry ALSO shipped with numbers not in the payload.
  // Payload carries the list of missing figures so the digest can count
  // classes of failure (single miss vs table fabrication).
  if (numericBackstopFired && status !== "declined") {
    flags.push({ receipt_miss: numericBackstopMisses || [] });
    if (status === "grounded") status = "partial";
  }
  if (flags.length) trajectory.push({ tool: null, kind: "downgrade", flags });

  // 2026-08-04 (architecture ruling): token-level redaction. If the numeric
  // backstop retry ALSO shipped with misses, mechanically replace each
  // offending numeric token in the shipped answer with `[unverified]`.
  // Kevin: "ugly, honest, and impossible to copy into a deck as fact."
  // Status stays partial with the existing receipt_miss reason chip.
  // Exemptions preserved (dates, ordinals, quoted content are masked out
  // of the redactor's target range by maskExempt() inside the helper).
  let shippedAnswer = cleanedWithNote;
  if (numericBackstopFired && Array.isArray(numericBackstopMisses) && numericBackstopMisses.length > 0) {
    shippedAnswer = redactMissingFigures(cleanedWithNote, numericBackstopMisses);
  }

  // 2026-08-04 (round 0b Part 4): L12 final self-check pass. Mechanical
  // only, no additional model call. Strips agreement / self-narration
  // openers (both belong to the retry-integrity family - the nudge fixes
  // the model behaviour but the strip is the mechanical guarantee),
  // internal-identifier leaks (with Source-line rewrite to human label),
  // and clock times from prose. Fence per Kevin's spec: may ONLY remove
  // or flag; never rewrite content; never strip inside quoted document
  // text (blockquotes and inline quotes are masked by isInsideQuoted in
  // selfCheck.js). Runs on declines too - a decline can still carry an
  // opener or a plumbing leak.
  const selfCheck = applySelfCheck(shippedAnswer, { question });
  shippedAnswer = selfCheck.answer;
  const stripSum =
    (selfCheck.strips.agreement || 0) +
    (selfCheck.strips.self_narration || 0) +
    (selfCheck.strips.plumbing || 0) +
    (selfCheck.strips.clock || 0);
  if (stripSum > 0) {
    trajectory.push({ tool: null, kind: "self-check-strip", counters: selfCheck.strips });
  }
  // 2026-08-04 (round 0b Part 5): multi-part completeness flag. When the
  // question is multi-part and one or more sub-questions lack any evidence
  // of an answer in the shipped text, flag partial with the new reason
  // chip "Part of your question could not be answered." Never applies to
  // declines (the decline IS the answer to the whole question).
  if (selfCheck.unaddressedParts.length > 0 && status !== "declined") {
    flags.push({ incomplete_multipart: selfCheck.unaddressedParts });
    if (status === "grounded") status = "partial";
    trajectory.push({ tool: null, kind: "incomplete-multipart", parts: selfCheck.unaddressedParts });
  }

  const declined = status === "declined";

  emit({ kind: "done", status, sources: validSources, truncated });

  return {
    answer: shippedAnswer,
    status,
    declined,
    decline_reason: declined ? decline_reason : null,
    sources: validSources,
    trajectory,
    usage,
    truncated,
    flags,
  };
}

function sanitizeInputForEmit(input) {
  // Nothing to strip today (no access field in any tool schema) but keep
  // the shim so future additions can filter here.
  return input;
}

function addUsage(usage, u) {
  if (!u) return;
  usage.input_tokens += u.input_tokens || 0;
  usage.output_tokens += u.output_tokens || 0;
  usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
}

// The standalone `streamFinal` helper was folded into the main loop as
// `streamedTurn` (declared inside runSousAgent) - every turn now streams,
// which removes the split behavior where intermediate turns used
// messages.create and only the terminal used messages.stream. See the
// runSousAgent while-loop for the unified path.
