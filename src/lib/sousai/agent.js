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

// ── Tunables ─────────────────────────────────────────────────────────────────
export const SOUSAI_AGENT_MODEL = "claude-sonnet-4-6";
// R3-05 rider (Kevin ruling): raised from 8 to 14 to comfortably cover a
// full account fan-out (an 11-account "breakfast per account" ask hit the
// old 8 budget after 6 tool calls, leaving 5 accounts unanswered). This is
// a stopgap - the real fix is a batch tool (Phase F candidate: wire
// `sc_month_summary` as an all-accounts one-call tool). No loop
// restructure, no parallelism; just the one constant.
export const TOOL_BUDGET = 14;
export const MAX_OUTPUT_TOKENS = 1024;

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

  // Cached system prompt + tool defs (Anthropic cache TTL for prompt caching).
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
      break;
    }

    // Tool use turn: execute every tool_use block, append tool_result content.
    const assistantContent = resp.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults = [];
    for (const block of assistantContent) {
      if (block.type !== "tool_use") continue;
      if (toolsUsed >= TOOL_BUDGET) {
        // Refuse further tools for this turn - return an error block to the
        // model so it can adapt and answer.
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: "tool budget exhausted" }),
          is_error: true,
        });
        continue;
      }
      const t0 = Date.now();
      emit({ kind: "tool-start", tool: block.name, input: sanitizeInputForEmit(block.input) });
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
      toolsUsed += 1;
      trajectory.push({
        tool: block.name,
        input: sanitizeInputForEmit(block.input),
        summary: summarizeToolResult(block.name, result),
        rawResult: result,
        tool_error: toolError,
        ms: t1 - t0,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: toolError,
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
  if (flags.length) trajectory.push({ tool: null, kind: "downgrade", flags });

  const declined = status === "declined";

  emit({ kind: "done", status, sources: validSources, truncated });

  return {
    answer: cleanedWithNote,
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
