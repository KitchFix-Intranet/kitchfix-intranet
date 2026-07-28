// ════════════════════════════════════════════════════════════════════════════
// /api/sousai · SousAI · Phase C · streaming + question log + feedback
// ════════════════════════════════════════════════════════════════════════════
//
// Two POST actions:
//   POST /api/sousai   { action: "ask", question: string }
//     -> text/event-stream:
//        event: tool_start   data: { tool, summary }
//        event: tool_end     data: { tool, ms }
//        event: token        data: { t }         answer deltas
//        event: error        data: { kind, message }   (never leaks raw SDK)
//        event: done         data: { question_id, status, declined,
//                                    decline_reason, sources, usage }
//                           question_id is the sousai_questions row id;
//                           null when the log insert failed (Sous still
//                           answers - logging is fire-and-forget).
//
//   POST /api/sousai   { action: "feedback", question_id, value: 1|-1, comment? }
//     -> JSON: 200 { ok: true } or 404 { error: "not found" }
//     Same flag/auth/tier gate as ask. Only the ORIGINAL ASKER may feedback
//     their own row (WHERE id = :question_id AND user_email = :email).
//
// Gate order (server-side, evaluated exactly in this sequence, both actions):
//   1. FLAG      SOUSAI_ROUTE_ENABLED === "true"  -> else 404-shaped disabled
//   2. AUTH      await auth() returns a session  -> else 401
//   3. TIER      viewerTier === 'slt' OR isCorporateEmail  -> else 403
//                (Phase D widens this; do not build widening here)
//   4. INPUT     per-action field validation      -> else 400
//
// Requests rejected by the gate (400/401/403/404) are NOT logged to
// sousai_questions. They never reach the agent, cost nothing, and are already
// captured in Vercel's access log. Only requests that reach `runSousAgent`
// produce a sousai_questions row (success or error).
//
// accessLevels are resolved server-side via opdAcl.allowedAccessLevels() from
// the SESSION email. The request body's access-level fields are IGNORED with
// prejudice: even if a client sends {accessLevels: ["slt"]}, the server uses
// the session-derived value. The runSousAgent contract never trusts the wire.
//
// Streaming shape note (unchanged from B2):
//   The B1 agent loop returns the assembled answer as one string and only
//   emits `first-token` (a marker) - not per-delta text events. For now the
//   route chunks the resolved answer into ~40-char pieces and emits token
//   events after runSousAgent settles. `token_burst_ms` here is the time
//   from stream start to the FIRST token event we emit (chunk 0). It will
//   become the true time-to-first-LLM-token when the agent gains per-delta
//   streaming - additive change with no wire-contract impact.
//
// Vercel maxDuration: 60s (matches sibling routes).
// ════════════════════════════════════════════════════════════════════════════

import { auth } from "@/lib/auth";
import { viewerTier, isCorporateEmail, allowedAccessLevels } from "@/lib/opdAcl";
import { getServiceClient } from "@/lib/supabase";
import { runSousAgent, SOUSAI_AGENT_MODEL } from "@/lib/sousai/agent.js";
import { evaluateGates } from "./gate.js";
import { logSousaiQuestion, updateSousaiFeedback } from "./log.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_CHUNK_SIZE = 40;

// Deps bundle for the gate (module-level constant, no per-request rebuild).
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
    body = null;
  }

  const session = await auth();
  const flagEnabled = process.env.SOUSAI_ROUTE_ENABLED === "true";
  const gate = await evaluateGates({ session, flagEnabled, body, deps: GATE_DEPS });

  if (!gate.pass) {
    if (gate.kind === "disabled") return jsonResponse(404, { error: "not found" });
    if (gate.kind === "auth") return jsonResponse(401, { error: "unauthorized" });
    if (gate.kind === "tier") return jsonResponse(403, { error: "forbidden" });
    if (gate.kind === "input") return jsonResponse(400, { error: gate.hint || "bad request" });
    return jsonResponse(500, { error: "unknown gate failure" });
  }

  if (gate.action === "feedback") return handleFeedback(gate);
  if (gate.action === "ask") return handleAsk(gate);
  return jsonResponse(500, { error: "gate returned an unknown action" });
}

// ── Feedback handler ────────────────────────────────────────────────────────

async function handleFeedback(gate) {
  const supabase = getServiceClient();
  const { updated, error } = await updateSousaiFeedback(supabase, {
    question_id: gate.question_id,
    user_email: gate.email,
    value: gate.value,
    comment: gate.comment,
  });
  if (error) return jsonResponse(500, { error: "feedback write failed" });
  if (updated === 0) return jsonResponse(404, { error: "not found" });
  return jsonResponse(200, { ok: true });
}

// ── Ask handler (SSE stream + fire-and-forget log) ──────────────────────────

async function handleAsk(gate) {
  const { question, accessLevels, email, tier } = gate;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (name, data) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(name, data)));
        } catch {
          // Client disconnected - swallow.
        }
      };

      const streamStart = Date.now();
      let firstTokenAt = null;

      const onEvent = (ev) => {
        if (ev.kind === "tool-start") {
          write("tool_start", { tool: ev.tool, summary: summarizeToolStart(ev.tool, ev.input) });
        } else if (ev.kind === "tool-end") {
          write("tool_end", { tool: ev.tool, ms: ev.ms });
        }
      };

      let result = null;
      let mappedError = null;
      try {
        result = await runSousAgent({ question, accessLevels, onEvent });

        // Chunk the final answer into token events. Record the first-token
        // wallclock so we can persist token_burst_ms.
        const text = result.answer || "";
        for (let i = 0; i < text.length; i += TOKEN_CHUNK_SIZE) {
          if (i === 0) firstTokenAt = Date.now();
          write("token", { t: text.slice(i, i + TOKEN_CHUNK_SIZE) });
        }
      } catch (err) {
        mappedError = mapSdkError(err);
        write("error", mappedError);
      }

      const latencyMs = Date.now() - streamStart;
      const tokenBurstMs = firstTokenAt ? firstTokenAt - streamStart : null;

      // Fire-and-forget log. We AWAIT because we need the row id for the
      // done envelope, but the log function catches all errors and returns
      // { id: null } on failure - it CANNOT take Sous down.
      const supabase = getServiceClient();
      const logPayload = {
        user_email: email,
        resolved_tier: tier,
        access_levels: accessLevels,
        question,
        status: result?.status ?? "error",
        declined: result?.declined ?? null,
        decline_reason: result?.decline_reason ?? null,
        answer: result?.answer ?? null,
        sources: result?.sources ?? null,
        trajectory: result?.trajectory ?? null,
        model: SOUSAI_AGENT_MODEL,
        latency_ms: latencyMs,
        token_burst_ms: tokenBurstMs,
        usage: result?.usage ?? null,
        error_kind: mappedError?.kind ?? null,
        error_message: mappedError?.message ?? null,
      };
      const { id: questionId } = await logSousaiQuestion(supabase, logPayload);

      // If there was an SDK error, we already wrote the error event; still
      // need to close the stream. Do NOT write a done envelope on error.
      if (!mappedError) {
        write("done", {
          question_id: questionId,
          status: result.status,
          declined: result.declined,
          decline_reason: result.decline_reason,
          sources: result.sources,
          usage: result.usage,
        });
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
