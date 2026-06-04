// ════════════════════════════════════════════════════════════════════════════
// /api/playbook/sous-demo - SousAI chat streaming endpoint (owner-only)
// ════════════════════════════════════════════════════════════════════════════
//
// POST { question } -> NDJSON stream of events:
//   {"type":"meta","declined":bool,"decline_reason":string|null,"sources_in_context":[...]}
//   {"type":"text","chunk":"..."}                                     (many)
//   {"type":"done","usage":{...}}
//   {"type":"error","message":"..."}                                  (on failure)
//
// Pipeline:
//   1. canViewPlaybook(session.email) gate - same pattern as the rest of the
//      Playbook API. Non-owners get 403.
//   2. prepareSousContext (retrieval + similarity threshold + prompt-building)
//      from sousai/generate.js. Decline path and answer path both produce a
//      systemPrompt + userMessage ready to stream.
//   3. Emit the meta event (sources_in_context for UI chips, declined flag
//      for UI styling) BEFORE the text stream so the UI can render the chip
//      row while the answer types in.
//   4. Anthropic streaming call (stream: true) - parse the SSE chunks, forward
//      text deltas as {"type":"text","chunk":...} events.
//   5. Final {"type":"done","usage":...} event when the stream completes.
//
// The ANTHROPIC_API_KEY_SOUS env var stays server-side. The client only sees
// the NDJSON event stream, never the key.
// ════════════════════════════════════════════════════════════════════════════

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { canViewPlaybook } from "@/lib/opdAcl";
import {
  prepareSousContext,
  SOUSAI_MODEL,
  SOUSAI_MAX_OUTPUT_TOKENS,
} from "@/lib/sousai/generate";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const actualEmail = session.user.email.toLowerCase().trim();
  if (!canViewPlaybook(actualEmail)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { question } = body;
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json(
      { error: "question is required (non-empty string)" },
      { status: 400 }
    );
  }

  const sousKey = process.env.ANTHROPIC_API_KEY_SOUS;
  if (!sousKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY_SOUS missing from server env" },
      { status: 500 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // controller may already be closed if client disconnected; ignore.
        }
      };

      try {
        // Step 1-2-3 from prepareSousContext: retrieve + threshold + prompts.
        const ctx = await prepareSousContext({ question });

        send({
          type: "meta",
          declined: ctx.declined,
          decline_reason: ctx.decline_reason,
          sources_in_context: ctx.sources_in_context,
          top_similarity: ctx.top_similarity,
        });

        // Step 4: streaming Claude call.
        const claudeResponse = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": sousKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: SOUSAI_MODEL,
            max_tokens: SOUSAI_MAX_OUTPUT_TOKENS,
            system: ctx.systemPrompt,
            messages: [{ role: "user", content: ctx.userMessage }],
            stream: true,
          }),
        });

        if (!claudeResponse.ok) {
          const txt = await claudeResponse.text().catch(() => "(no body)");
          send({
            type: "error",
            message: `Anthropic ${claudeResponse.status}: ${txt.slice(0, 300)}`,
          });
          controller.close();
          return;
        }

        // Step 5: parse Anthropic SSE, forward text deltas + capture usage.
        const reader = claudeResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let usage = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Anthropic SSE format: alternating "event: X" and "data: {...}"
            // lines, blank lines between events. We only care about data lines.
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);
              if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta" &&
                typeof event.delta.text === "string"
              ) {
                send({ type: "text", chunk: event.delta.text });
              } else if (event.type === "message_delta" && event.usage) {
                // Anthropic emits usage updates here; capture the latest.
                usage = { ...(usage || {}), ...event.usage };
              } else if (event.type === "message_start" && event.message?.usage) {
                usage = { ...(usage || {}), ...event.message.usage };
              }
            } catch {
              // Ignore parse errors on unknown event shapes.
            }
          }
        }

        send({ type: "done", usage });
        controller.close();
      } catch (e) {
        send({ type: "error", message: e?.message || "unknown error" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
