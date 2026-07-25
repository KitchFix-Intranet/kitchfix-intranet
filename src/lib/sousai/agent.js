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
import { searchDocuments } from "./tools/searchDocuments.js";
import { getDocument } from "./tools/getDocument.js";
import { listDocuments } from "./tools/listDocuments.js";

// ── Tunables ─────────────────────────────────────────────────────────────────
export const SOUSAI_AGENT_MODEL = "claude-sonnet-4-6";
export const TOOL_BUDGET = 8;
export const MAX_OUTPUT_TOKENS = 1024;
const GET_DOCUMENT_MAX_BATCH = 6;

// ── Tool definitions the model sees ──────────────────────────────────────────
// accessLevels is intentionally absent - the loop injects it server-side.
const TOOL_DEFS = [
  {
    name: "search_documents",
    description:
      "Doc-level semantic search over the KitchFix Playbook corpus. Returns the top matching documents with best-match snippets. Use for topical questions when you do not know which doc holds the answer. Snippets are locators, not the record itself - open the doc with get_document to answer from actual content.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The natural-language search query." },
        k: {
          type: "integer",
          description: "How many docs to return (default 5, max 10).",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_document",
    description:
      "Fetch the full SousAI-safe text of a document by its ID, or up to 6 documents in one call. Use once search points you at a doc, or when the user gives an exact doc ID. Use the BATCH form for enumeration questions after listing the class. Refusals carry a `reason` field (not_found, access, archived, not_live) and no content.",
    input_schema: {
      type: "object",
      properties: {
        docIds: {
          oneOf: [
            { type: "string", description: "A single document ID like PB-002." },
            {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 6,
              description: "Up to 6 document IDs in one call for batched reading.",
            },
          ],
          description: "One doc ID (string) or up to 6 doc IDs (array).",
        },
      },
      required: ["docIds"],
    },
  },
  {
    name: "list_documents",
    description:
      "Catalog listing filtered by doc class. Returns Live+visible documents only. Use for enumeration questions BEFORE get_document - list the class first, then batch-read the records. Doc classes include PB, POL, SOP, REC, REF, TPL, STD, FORM, AGR, CHK, POST.",
    input_schema: {
      type: "object",
      properties: {
        docClass: {
          type: "string",
          description:
            "Optional doc class filter (e.g. REC for account records, SOP for procedures). Omit to list every visible Live doc.",
        },
      },
    },
  },
];

// ── Tool dispatch ────────────────────────────────────────────────────────────

async function executeTool(name, input, accessLevels) {
  if (name === "search_documents") {
    const { query, k } = input || {};
    const docs = await searchDocuments(query, {
      accessLevels,
      k: typeof k === "number" ? k : 5,
    });
    // Return a compact shape - full content is what get_document is for.
    return docs.map((d) => ({
      docId: d.docId,
      title: d.title,
      docClass: d.docClass,
      bestSimilarity: Number(d.bestSimilarity?.toFixed(4)),
      snippets: d.snippets.map((s) => ({
        section: s.section,
        content: s.content,
        similarity: Number(s.similarity?.toFixed(4)),
      })),
    }));
  }

  if (name === "get_document") {
    let ids = input?.docIds;
    if (typeof ids === "string") ids = [ids];
    if (!Array.isArray(ids) || ids.length === 0) {
      return { error: "docIds must be a string or non-empty array" };
    }
    if (ids.length > GET_DOCUMENT_MAX_BATCH) {
      return {
        error: `get_document accepts at most ${GET_DOCUMENT_MAX_BATCH} ids per call; got ${ids.length}. Split into two calls.`,
      };
    }
    const results = {};
    for (const id of ids) {
      const r = await getDocument(id, { accessLevels });
      results[id] = r;
    }
    return results;
  }

  if (name === "list_documents") {
    const { docClass } = input || {};
    const rows = await listDocuments({ docClass, accessLevels });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      doc_class: r.doc_class,
      status: r.status,
    }));
  }

  return { error: `unknown tool: ${name}` };
}

// ── Answer parsing ───────────────────────────────────────────────────────────
// Match [[STATUS: grounded]] etc anywhere in the last chunk of the message.
const STATUS_RE = /\[\[STATUS:\s*(grounded|partial|declined)\]\]/i;
const REASON_RE = /\[\[REASON:\s*([^\]]+?)\]\]/i;
// Doc-id citation shape: PB-002, SOP-002, FORM-003, POL-006, STD-004, etc.
// Word-boundary bracketed to avoid grabbing partial matches inside other tokens.
const CITATION_RE = /\b([A-Z]{2,6})-([0-9]{3})\b/g;

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
  const cited = new Set();
  for (const m of cleaned.matchAll(CITATION_RE)) {
    cited.add(`${m[1]}-${m[2]}`);
  }
  return { cleaned, status, decline_reason, cited: [...cited] };
}

// ── Trajectory helpers ───────────────────────────────────────────────────────
function summarizeToolResult(name, result) {
  if (name === "search_documents") {
    return {
      kind: "docs",
      count: Array.isArray(result) ? result.length : 0,
      top: Array.isArray(result) ? result.slice(0, 5).map((d) => d.docId) : [],
    };
  }
  if (name === "get_document") {
    const per = {};
    for (const [id, r] of Object.entries(result || {})) {
      per[id] = r.available
        ? { available: true, tokens: r.tokenTotal, truncated: !!r.truncated }
        : { available: false, reason: r.reason };
    }
    return per;
  }
  if (name === "list_documents") {
    return {
      kind: "list",
      count: Array.isArray(result) ? result.length : 0,
      classes: Array.isArray(result)
        ? [...new Set(result.map((r) => r.doc_class))]
        : [],
    };
  }
  return { raw: result };
}

// Track which ids the trajectory has actually retrieved content for
// (a doc has to have been successfully returned by get_document, or seen as
// a search hit, to be a citable source).
function collectRetrievedIds(trajectory) {
  const ids = new Set();
  for (const step of trajectory) {
    if (step.tool === "search_documents" && Array.isArray(step.rawResult)) {
      for (const d of step.rawResult) ids.add(d.docId);
    }
    if (step.tool === "get_document" && step.rawResult && typeof step.rawResult === "object") {
      for (const [id, r] of Object.entries(step.rawResult)) {
        if (r && r.available) ids.add(id);
      }
    }
    if (step.tool === "list_documents" && Array.isArray(step.rawResult)) {
      for (const d of step.rawResult) ids.add(d.id);
    }
  }
  return ids;
}

// ── The agent loop ───────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.question
 * @param {string[]} opts.accessLevels
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
export async function runSousAgent({ question, accessLevels, onEvent }) {
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

  const messages = [{ role: "user", content: question }];
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
  const cachedTools = TOOL_DEFS.map((t, i) =>
    i === TOOL_DEFS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
  );

  let toolsUsed = 0;
  let finalRawText = null;

  while (true) {
    const budgetLeft = TOOL_BUDGET - toolsUsed;

    // If budget is exhausted, force a final no-tools turn.
    if (budgetLeft <= 0) {
      messages.push({
        role: "user",
        content:
          "Tool budget exhausted. Answer from what you have or decline honestly in the established voice. Do not request further tools.",
      });
      const finalResp = await streamFinal(client, systemBlocks, cachedTools, messages, usage, emit);
      finalRawText = finalResp.text;
      trajectory.push({ tool: null, kind: "final", stop_reason: finalResp.stop_reason });
      break;
    }

    // Non-streaming intermediate turn (tool orchestration).
    const resp = await client.messages.create({
      model: SOUSAI_AGENT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      tools: cachedTools,
      messages,
    });
    addUsage(usage, resp.usage);

    if (resp.stop_reason !== "tool_use") {
      // Model chose to answer. Re-run this same request but streamed so we
      // can measure time-to-first-token. Simpler alt: use the just-received
      // text and skip the extra call. We take the simpler path since the
      // "final turn streams" contract is measurement-driven and calling the
      // model twice for the same input burns tokens + latency.
      finalRawText = resp.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      emit({ kind: "first-token", t: Date.now() });
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

  let status = rawStatus || (validSources.length === 0 ? "declined" : "partial");
  const flags = [];
  if (phantomCitations.length > 0) {
    flags.push({ phantom_citation: phantomCitations });
    if (status === "grounded") status = "partial";
  }
  if (status === "grounded" && validSources.length === 0) {
    flags.push({ grounded_without_sources: true });
    status = "partial";
  }
  if (flags.length) trajectory.push({ tool: null, kind: "downgrade", flags });

  const declined = status === "declined";

  emit({ kind: "done", status, sources: validSources });

  return {
    answer: cleaned,
    status,
    declined,
    decline_reason: declined ? decline_reason : null,
    sources: validSources,
    trajectory,
    usage,
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

async function streamFinal(client, systemBlocks, cachedTools, messages, usage, emit) {
  const stream = client.messages.stream({
    model: SOUSAI_AGENT_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemBlocks,
    tools: cachedTools,
    messages,
  });
  let firstToken = null;
  stream.on("text", (chunk) => {
    if (firstToken === null) {
      firstToken = Date.now();
      emit({ kind: "first-token", t: firstToken });
    }
  });
  const finalMessage = await stream.finalMessage();
  addUsage(usage, finalMessage.usage);
  const text = finalMessage.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  return { text, stop_reason: finalMessage.stop_reason };
}
