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
// Streaming shape note (updated Phase D precondition, 2026-07-28):
//   The agent loop now streams every turn via client.messages.stream and
//   emits `text-delta` events as the model writes each delta. The route
//   forwards those as `token` events LIVE - the client sees text arrive
//   as the model generates it, not after settle.
//
//   `token_burst_ms` captures the wallclock of the first `text-delta`,
//   which is the true time-to-first-LLM-token. Under the old post-settle
//   chunk-loop, token_burst_ms was equal to latency_ms (both measured at
//   settle). Under the new live-delta path, token_burst_ms is materially
//   smaller than latency_ms - that divergence is the observable that the
//   refactor worked.
//
//   Wire contract unchanged from the client's perspective: token events
//   still arrive between tool_end and done. Only the timing is real now.
//
// Vercel maxDuration: 60s (matches sibling routes).
// ════════════════════════════════════════════════════════════════════════════

import { auth } from "@/lib/auth";
import { viewerTier, canUseSous, allowedAccessLevels } from "@/lib/opdAcl";
import { getServiceClient } from "@/lib/supabase";
import { runSousAgent, SOUSAI_AGENT_MODEL } from "@/lib/sousai/agent.js";
import { evaluateGates } from "./gate.js";
import { logSousaiQuestion, updateSousaiFeedback } from "./log.js";
import { initFooterState, advance as advanceFooterState, flush as flushFooterState } from "./suppressFooter.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// (removed 2026-07-28) TOKEN_CHUNK_SIZE - the post-settle chunk loop that
// used it is gone; the agent now emits `text-delta` events live and the
// route forwards them as `token` events one delta at a time.

// Deps bundle for the gate (module-level constant, no per-request rebuild).
const GATE_DEPS = { viewerTier, canUseSous, allowedAccessLevels };

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
// Human action label per tool. Every tool in the registry must appear here;
// the fallback returns "running" (never the raw tool name - a "list_contacts_
// by_role list_contacts_by_role" bug in the tool trail traced to the previous
// tool-name fallback echoing on both the summary AND the tool-name column).
function summarizeToolStart(tool, input) {
  // Document tools
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
  // Directory tools
  if (tool === "find_contact") {
    const q = String(input?.nameQuery || "").trim();
    return q ? `looking up ${q}` : "looking up a contact";
  }
  if (tool === "list_accounts") {
    return input?.level ? `listing ${input.level} accounts` : "listing accounts";
  }
  if (tool === "list_contacts_by_role") {
    const role = String(input?.role || "").trim();
    const ak = input?.teamKey ? ` at ${input.teamKey}` : "";
    return role ? `looking up ${role}s${ak}` : "looking up contacts";
  }
  if (tool === "get_account_team") {
    return input?.teamKey ? `looking up the ${input.teamKey} team` : "looking up an account team";
  }
  // Service Calendar tools
  if (tool === "sc_orientation") {
    return input?.accountKey ? `checking ${input.accountKey}'s orientation` : "checking calendar orientation";
  }
  if (tool === "sc_account_window") {
    const ak = input?.accountKey ? ` ${input.accountKey}` : "";
    const w = input?.window ? ` ${input.window}` : "";
    return `pulling${ak} calendar${w}`.trim() || "pulling calendar data";
  }
  if (tool === "sc_homestand_detail") {
    return input?.accountKey ? `reading ${input.accountKey}'s homestand` : "reading homestand detail";
  }
  if (tool === "sc_service_price") {
    return input?.accountKey ? `looking up ${input.accountKey}'s price` : "looking up a service price";
  }
  // Spend tools
  if (tool === "spend_summary") {
    return "reading spending";
  }
  if (tool === "spend_vendor_history") {
    return input?.vendorName ? `reading ${input.vendorName}'s history` : "reading vendor history";
  }
  if (tool === "spend_top_vendors") {
    return "ranking top vendors";
  }
  return "running";
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
    tags: gate.tags,
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

      // Trailing-sentinel suppression for the machine `[[STATUS: ...]]`
      // footer. Before delta streaming (#541), the route chunked
      // `result.answer` after settle - answer was already stripped by
      // parseAnswer(), so the footer never reached the wire. Under live
      // deltas the model writes the footer as the last text chunk and it
      // leaks. `advanceFooterState` holds back the longest suffix that
      // could still turn into the sentinel; on sentinel appearance it
      // returns "hit" and all subsequent deltas are dropped. On stream
      // end, any held-back non-sentinel prose flushes onto the wire.
      let footerState = initFooterState();

      // Forward agent events onto the SSE wire live.
      // token_burst_ms captures the wallclock of the first FORWARDED
      // character (not the first raw delta) - a delta that gets held
      // back for sentinel-check doesn't count as time-to-first-token.
      const onEvent = (ev) => {
        if (ev.kind === "tool-start") {
          write("tool_start", { tool: ev.tool, summary: summarizeToolStart(ev.tool, ev.input) });
        } else if (ev.kind === "tool-end") {
          write("tool_end", { tool: ev.tool, ms: ev.ms });
        } else if (ev.kind === "text-delta") {
          const { forward, next } = advanceFooterState(footerState, ev.t);
          footerState = next;
          if (forward.length > 0) {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            write("token", { t: forward });
          }
        }
      };

      let result = null;
      let mappedError = null;
      try {
        result = await runSousAgent({ question, accessLevels, onEvent });
      } catch (err) {
        mappedError = mapSdkError(err);
        write("error", mappedError);
      }

      // Flush any pending footer buffer as a final token event. This only
      // fires when held-back chars never became the sentinel (edge case:
      // stream ends mid-prefix). If suppression fired, this is a no-op.
      const tail = flushFooterState(footerState);
      if (tail.length > 0) {
        if (firstTokenAt === null) firstTokenAt = Date.now();
        write("token", { t: tail });
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
        // I2 - hydrate source docIds to {docId, title} using the docs
        // catalog so the source card renders a real title. Missing rows
        // (id not in documents, archived, whatever) fall through to title
        // = null - the UI degrades to id-chip alone.
        const rawSources = Array.isArray(result.sources) ? result.sources : [];
        let hydratedSources = rawSources.map((docId) => ({ docId, title: null }));
        if (rawSources.length > 0) {
          try {
            const { data: docRows } = await supabase
              .from("documents")
              .select("id, title")
              .in("id", rawSources);
            const titleById = new Map((docRows || []).map((r) => [r.id, r.title]));
            hydratedSources = rawSources.map((docId) => ({
              docId,
              title: titleById.get(docId) || null,
            }));
          } catch { /* fall through to null-title shape */ }
        }
        write("done", {
          question_id: questionId,
          status: result.status,
          declined: result.declined,
          decline_reason: result.decline_reason,
          sources: hydratedSources,
          usage: result.usage,
          truncated: result.truncated ?? false,
          flags: result.flags ?? [],
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
