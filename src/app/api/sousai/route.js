// ════════════════════════════════════════════════════════════════════════════
// /api/sousai · SousAI · Phase B2 · server-sent-events streaming route
// ════════════════════════════════════════════════════════════════════════════
//
// One POST action for now:
//   POST /api/sousai   { action: "ask", question: string }
//     -> text/event-stream:
//        event: tool_start   data: { tool, summary }
//        event: tool_end     data: { tool, ms }
//        event: token        data: { t }         answer deltas
//        event: error        data: { kind, message }   (never leaks raw SDK)
//        event: done         data: { status, declined, decline_reason,
//                                    sources, usage }
//
// Gate order (server-side, evaluated exactly in this sequence):
//   1. FLAG      SOUSAI_ROUTE_ENABLED === "true"  -> else 404-shaped disabled
//   2. AUTH      await auth() returns a session  -> else 401
//   3. TIER      viewerTier === 'slt' OR isCorporateEmail  -> else 403
//                (Phase D widens this; do not build widening here)
//   4. INPUT     action==="ask" AND question trimmed length in (0, 2000]
//                                                  -> else 400
//
// accessLevels are resolved server-side via opdAcl.allowedAccessLevels() from
// the SESSION email. The request body's access-level fields are IGNORED with
// prejudice: even if a client sends {accessLevels: ["slt"]}, the server uses
// the session-derived value. The runSousAgent contract never trusts the wire.
//
// Streaming shape note:
//   The B1 agent loop returns the assembled answer as one string and only
//   emits `first-token` (a marker) - not per-delta text events. Emitting real
//   LLM deltas would require modifying agent.js's terminal-turn code path.
//   For Phase B2 the route chunks the resolved answer into ~40-char pieces
//   and emits token events after runSousAgent settles - the wire contract to
//   the client is preserved (`token` events arrive between tool_end and done)
//   but they are not real LLM deltas. Real deltas can land in a follow-up
//   without a wire-contract change.
//
// Vercel maxDuration: 60s (matches sibling routes). runSousAgent's typical
// wall time on the spike ranged 2-30s; the 60s cap is generous headroom.
// ════════════════════════════════════════════════════════════════════════════

import { auth } from "@/lib/auth";
import { viewerTier, isCorporateEmail, allowedAccessLevels } from "@/lib/opdAcl";
import { runSousAgent } from "@/lib/sousai/agent.js";
import { evaluateGates, MAX_QUESTION_CHARS } from "./gate.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_CHUNK_SIZE = 40;

// Deps bundle for the gate. Kept as a module-level constant so the route
// hot-path does not rebuild the object per request.
const GATE_DEPS = { viewerTier, isCorporateEmail, allowedAccessLevels };

// ── Small SSE writers ────────────────────────────────────────────────────────

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ── SDK error mapping ────────────────────────────────────────────────────────
// Never leak SDK bodies or key material. Map to the wire-contract error kinds.
function mapSdkError(err) {
  const status = err?.status;
  const rawMessage = String(err?.message || "");
  const errType = err?.error?.error?.type || err?.error?.type;

  // Credit exhaustion: the Anthropic 400 body reads "credit balance is too low".
  if (/credit balance is too low/i.test(rawMessage) || errType === "invalid_request_error") {
    if (/credit/i.test(rawMessage)) {
      return { kind: "credit_exhausted", message: "SousAI is temporarily unavailable (billing)." };
    }
  }
  if (status === 401 || /invalid API key|authentication/i.test(rawMessage)) {
    return { kind: "auth", message: "SousAI upstream auth failed." };
  }
  if (status === 429 || /rate limit/i.test(rawMessage)) {
    return { kind: "rate_limit", message: "SousAI is rate limited. Try again in a moment." };
  }
  if (/timeout|timed out|aborted/i.test(rawMessage)) {
    return { kind: "timeout", message: "SousAI request timed out." };
  }
  return { kind: "unknown", message: "SousAI failed. Try again." };
}

// ── Human-readable tool-start summaries ──────────────────────────────────────
function summarizeToolStart(tool, input) {
  if (tool === "search_documents") {
    const q = String(input?.query || "");
    return q ? `searching the Playbook for "${q}"` : "searching the Playbook";
  }
  if (tool === "get_document") {
    const ids = input?.docIds;
    if (Array.isArray(ids)) return `reading ${ids.slice(0, 6).join(", ")}`;
    if (typeof ids === "string") return `reading ${ids}`;
    return "reading a document";
  }
  if (tool === "list_documents") {
    return input?.docClass ? `listing ${input.docClass} documents` : "listing documents";
  }
  return tool;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    // Body parse failure - fall through with body=null so evaluateGates
    // returns the 400 shape.
    body = null;
  }

  const session = await auth();
  const flagEnabled = process.env.SOUSAI_ROUTE_ENABLED === "true";

  const gate = await evaluateGates({ session, flagEnabled, body, deps: GATE_DEPS });

  if (!gate.pass) {
    if (gate.kind === "disabled") {
      return jsonResponse(404, { error: "not found" });
    }
    if (gate.kind === "auth") return jsonResponse(401, { error: "unauthorized" });
    if (gate.kind === "tier") return jsonResponse(403, { error: "forbidden" });
    if (gate.kind === "input") return jsonResponse(400, { error: gate.hint || "bad request" });
    return jsonResponse(500, { error: "unknown gate failure" });
  }

  const { question, accessLevels } = gate;

  // Build the SSE stream. All agent events are forwarded through this
  // controller in real time; the final answer is chunked and emitted as
  // token events after runSousAgent settles.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (name, data) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(name, data)));
        } catch {
          // Client disconnected mid-stream - swallow; the run continues but
          // no further writes will be attempted.
        }
      };

      // Adapt runSousAgent's onEvent to the SSE wire.
      const onEvent = (ev) => {
        if (ev.kind === "tool-start") {
          write("tool_start", { tool: ev.tool, summary: summarizeToolStart(ev.tool, ev.input) });
        } else if (ev.kind === "tool-end") {
          write("tool_end", { tool: ev.tool, ms: ev.ms });
        }
        // first-token and done from the agent are intentionally NOT forwarded
        // to the wire - they duplicate wire events we synthesize here.
      };

      try {
        const result = await runSousAgent({ question, accessLevels, onEvent });

        // Chunk the final answer into token events. See streaming-shape note
        // in the header comment.
        const text = result.answer || "";
        for (let i = 0; i < text.length; i += TOKEN_CHUNK_SIZE) {
          write("token", { t: text.slice(i, i + TOKEN_CHUNK_SIZE) });
        }
        // If the answer was empty, no token event fires. That is fine - the
        // done event will still carry the status.

        write("done", {
          status: result.status,
          declined: result.declined,
          decline_reason: result.decline_reason,
          sources: result.sources,
          usage: result.usage,
        });
      } catch (err) {
        const mapped = mapSdkError(err);
        write("error", mapped);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Guardrail against Vercel edge/CDN buffering interfering with SSE.
      "X-Accel-Buffering": "no",
    },
  });
}
