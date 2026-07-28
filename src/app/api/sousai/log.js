// ────────────────────────────────────────────────────────────────────────────
// /api/sousai · log.js · sousai_questions logger (fire-and-forget)
// ────────────────────────────────────────────────────────────────────────────
//
// One entry point:
//   logSousaiQuestion(supabase, payload) -> { id | null }
//
// Fire-and-forget contract:
//   The caller AWAITS the returned promise (to get the row id for the `done`
//   envelope), but any error is caught inside logSousaiQuestion and returns
//   { id: null } - it NEVER throws. A dead log table must not take Sous down.
//   Errors are console.errored with a stable prefix for grep-ability.
//
// Payload shape (all present on success rows; error rows omit answer/sources/
// trajectory/usage and carry error_kind/error_message):
//   {
//     user_email, resolved_tier, access_levels, question,
//     status, declined, decline_reason, answer, sources,
//     trajectory, model, latency_ms, token_burst_ms, usage,
//     error_kind, error_message,
//   }
//
// Trajectory sanitization is forensics-grade (Chat 2026-07-28 addendum):
//   - search_documents entries record { query, k, docs: [{docId, bestSimilarity}] }
//     with bestSimilarity rounded to 2 decimals. NO snippet content.
//   - get_document entries record { docIds: [...], results: {id: {available,
//     reason?, tokens?, truncated?}} }. NO document text.
//   - list_documents entries record { filter, count, classes }. Filter shows
//     what was requested; classes shows what was returned.
//   Any other keys on the raw trajectory step (rawResult, tool_error, ms,
//   kind) are preserved except for rawResult which is dropped everywhere it
//   appears - rawResult carries snippets/content and must never persist.
//   Rationale: Chat's improvement digest triages declines into corpus-gap vs
//   retrieval-miss vs correct-decline using exactly these fields; rows logged
//   without them are permanently blind and backfill is impossible.
// ────────────────────────────────────────────────────────────────────────────

function round2(n) {
  return typeof n === "number" ? Math.round(n * 100) / 100 : null;
}

export function sanitizeTrajectoryForLog(trajectory) {
  if (!Array.isArray(trajectory)) return null;
  return trajectory.map((step) => {
    // Non-tool steps (final markers, downgrade flags) pass through minus
    // rawResult.
    if (!step || !step.tool) {
      const { rawResult: _drop, ...rest } = step || {};
      return rest;
    }

    if (step.tool === "search_documents") {
      const raw = Array.isArray(step.rawResult) ? step.rawResult : [];
      const docs = raw.map((d) => ({
        docId: d.docId,
        docClass: d.docClass ?? null,
        bestSimilarity: round2(d.bestSimilarity),
      }));
      return {
        tool: "search_documents",
        query: step.input?.query ?? null,
        k: step.input?.k ?? null,
        docs,
        ms: step.ms ?? null,
        tool_error: step.tool_error ?? false,
      };
    }

    if (step.tool === "get_document") {
      const rawInput = step.input?.docIds;
      const docIds = Array.isArray(rawInput) ? rawInput : (typeof rawInput === "string" ? [rawInput] : []);
      // step.summary is already { [id]: {available, tokens?, truncated?} | {available:false, reason} }
      const results = {};
      const summary = step.summary || {};
      for (const [id, r] of Object.entries(summary)) {
        if (r?.available === true) {
          results[id] = { available: true, tokens: r.tokens ?? null, truncated: !!r.truncated };
        } else if (r?.available === false) {
          results[id] = { available: false, reason: r.reason || "unknown" };
        } else {
          results[id] = r;
        }
      }
      return {
        tool: "get_document",
        docIds,
        results,
        ms: step.ms ?? null,
        tool_error: step.tool_error ?? false,
      };
    }

    if (step.tool === "list_documents") {
      return {
        tool: "list_documents",
        filter: step.input ?? {},
        count: step.summary?.count ?? null,
        classes: step.summary?.classes ?? null,
        ms: step.ms ?? null,
        tool_error: step.tool_error ?? false,
      };
    }

    // Unknown tool - drop rawResult defensively.
    const { rawResult: _drop, ...rest } = step;
    return rest;
  });
}

export async function logSousaiQuestion(supabase, payload) {
  try {
    const sanitized = {
      ...payload,
      trajectory: payload.trajectory ? sanitizeTrajectoryForLog(payload.trajectory) : null,
    };
    const { data, error } = await supabase
      .from("sousai_questions")
      .insert(sanitized)
      .select("id")
      .single();
    if (error) {
      console.error("[sousai/log] insert failed:", error.code || "?", error.message || "(no message)");
      return { id: null };
    }
    return { id: data.id };
  } catch (e) {
    console.error("[sousai/log] insert threw:", e?.message || String(e));
    return { id: null };
  }
}

// Feedback update. Asker-only: WHERE id AND user_email. Returns the count of
// updated rows so the route can distinguish "not found / not yours" (0)
// from "updated" (1). Never throws.
export async function updateSousaiFeedback(supabase, { question_id, user_email, value, comment }) {
  try {
    const { data, error } = await supabase
      .from("sousai_questions")
      .update({
        feedback: value,
        feedback_comment: comment,
        feedback_at: new Date().toISOString(),
      })
      .eq("id", question_id)
      .eq("user_email", user_email)
      .select("id");
    if (error) {
      console.error("[sousai/log] feedback update failed:", error.code || "?", error.message || "(no message)");
      return { updated: 0, error: true };
    }
    return { updated: (data || []).length, error: false };
  } catch (e) {
    console.error("[sousai/log] feedback update threw:", e?.message || String(e));
    return { updated: 0, error: true };
  }
}
